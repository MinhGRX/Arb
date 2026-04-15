import axios from "axios";
import { OddsUpdate } from "../types";
import { BaseAdapter, AdapterConfig, OddsCallback } from "./base";

/**
 * Generic WebSocket/REST scraper for SABA and other Asian books
 * that expose a JSON endpoints on their member portals.
 *
 * SABA Sport's odds are typically served from their CDN at:
 *   https://cdn.saba.sport/odds/GetOddsV2?...
 *
 * This adapter supports:
 *  - Configurable endpoint URL
 *  - Bearer token auth (for sites that need it)
 *  - Custom response mapper
 *
 * Usage: extend this class and override `mapResponse()` for each site's
 * specific response schema.
 */

export interface ScraperConfig extends AdapterConfig {
  /** Base URL of the odds JSON endpoint */
  endpointUrl: string;
  /** Auth header if required: "Bearer xxx" or "Basic xxx" */
  authHeader?: string;
  /** Additional query params */
  params?: Record<string, string>;
  /** Which bookmaker name to label these odds as */
  bookmaker: string;
  /** SHARP or ASIAN */
  sourceType: "SHARP" | "ASIAN";
}

export abstract class ScrapeAdapter extends BaseAdapter {
  protected scrapeConfig: ScraperConfig;

  constructor(config: ScraperConfig, onOdds: OddsCallback) {
    super(config, onOdds);
    this.scrapeConfig = config;
  }

  get bookmakerName() { return this.scrapeConfig.bookmaker; }
  get sourceType(): "SHARP" | "ASIAN" { return this.scrapeConfig.sourceType; }

  async fetchOdds(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": new URL(this.scrapeConfig.endpointUrl).origin + "/",
      };
      if (this.scrapeConfig.authHeader) {
        headers["Authorization"] = this.scrapeConfig.authHeader;
      }

      const res = await axios.get(this.scrapeConfig.endpointUrl, {
        headers,
        params: this.scrapeConfig.params,
        timeout: 8000,
      });

      const updates = this.mapResponse(res.data);
      this.emit(updates);
      console.log(`[${this.bookmakerName}] Fetched ${updates.length} updates`);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        console.error(`[${this.bookmakerName}] Auth required — check authHeader config`);
      } else {
        console.error(`[${this.bookmakerName}] Fetch error: ${err.message}`);
      }
    }
  }

  /** Override this to map the raw API response to OddsUpdate[] */
  protected abstract mapResponse(data: unknown): OddsUpdate[];
}

// ─── SABA Concrete Adapter ────────────────────────────────────────────────────

/**
 * SABA Sport odds adapter.
 * SABA exposes odds on their CDN — the exact endpoint varies per operator.
 * This maps SABA's V3 odds format.
 *
 * Typical endpoint: https://cdn.saba.sport/odds/GetOddsV2
 * Params: sportId=1 (soccer), leagueId=..., oddsType=HDP|OU|1X2
 */
export class SabaAdapter extends ScrapeAdapter {
  constructor(
    endpointUrl: string,
    authHeader: string | undefined,
    config: Omit<ScraperConfig, "endpointUrl" | "bookmaker" | "sourceType">,
    onOdds: OddsCallback
  ) {
    super(
      {
        ...config,
        endpointUrl,
        authHeader,
        bookmaker: "SABA",
        sourceType: "ASIAN",
      },
      onOdds
    );
  }

  protected mapResponse(data: unknown): OddsUpdate[] {
    const updates: OddsUpdate[] = [];
    const now = Date.now();

    // SABA V2 response shape (adjust based on actual endpoint)
    const payload = data as {
      data?: {
        matches?: Array<{
          matchId: string;
          homeTeam: string;
          awayTeam: string;
          sport: string;
          hdp?: { home: number; away: number; hdp: number };
          ou?: { over: number; under: number; total: number };
          ml?: { home: number; draw: number; away: number };
        }>;
      };
    };

    for (const match of payload?.data?.matches ?? []) {
      const matchId = `${match.homeTeam} vs ${match.awayTeam}`;

      if (match.hdp) {
        updates.push(this.u(matchId, match.sport, "handicap", match.hdp.hdp, "home", match.hdp.home, now));
        updates.push(this.u(matchId, match.sport, "handicap", match.hdp.hdp, "away", match.hdp.away, now));
      }
      if (match.ou) {
        updates.push(this.u(matchId, match.sport, "over_under", match.ou.total, "over", match.ou.over, now));
        updates.push(this.u(matchId, match.sport, "over_under", match.ou.total, "under", match.ou.under, now));
      }
      if (match.ml) {
        updates.push(this.u(matchId, match.sport, "1x2", 0, "home", match.ml.home, now));
        updates.push(this.u(matchId, match.sport, "1x2", 0, "draw", match.ml.draw, now));
        updates.push(this.u(matchId, match.sport, "1x2", 0, "away", match.ml.away, now));
      }
    }

    return updates;
  }

  private u(
    matchId: string, sport: string,
    market: "1x2" | "over_under" | "handicap",
    line: number, outcome: string, odds: number, ts: number
  ): OddsUpdate {
    return { match_id: matchId, sport, market, line, bookmaker: "SABA", source_type: "ASIAN", outcome, odds, timestamp: ts };
  }
}
