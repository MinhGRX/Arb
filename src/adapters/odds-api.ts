import axios from "axios";
import { OddsUpdate, MarketType } from "../types";
import { BaseAdapter, AdapterConfig, OddsCallback } from "./base";

// ─── The Odds API — https://the-odds-api.com ─────────────────────────────────
// Covers: pinnacle, betway, williamhill, unibet, DraftKings, FanDuel,
//         betonlineag, mybookieag, lowvig, sportsbetting, etc.
// Asian market region covers: pinnacle + some sharp/asian-style books

// Map The Odds API bookmaker key → our source_type
const ASIAN_BOOK_KEYS: Set<string> = new Set([
  "pinnacle", "lowvig", "betonlineag", "betcris",
  "mybookieag", "sportsbetting", "circasports",
]);

// Map sport labels → The Odds API sport keys
// Multiple keys per sport = multiple API calls (costs more quota)
const SPORT_KEY_GROUPS: Record<string, string[]> = {
  soccer: [
    "soccer_epl",
    "soccer_germany_bundesliga",
    "soccer_spain_la_liga",
    "soccer_italy_serie_a",
    "soccer_france_ligue_one",
    "soccer_uefa_champs_league",
  ],
  basketball: [
    "basketball_nba",
    "basketball_euroleague",
  ],
  tennis: ["tennis_atp_french_open"],
  americanfootball: ["americanfootball_nfl"],
  baseball: ["baseball_mlb"],
  icehockey: ["icehockey_nhl"],
};

// ─── Raw API types ────────────────────────────────────────────────────────────

interface OddsApiGame {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

interface OddsApiMarket {
  key: string; // h2h | spreads | totals
  last_update: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface OddsApiAdapterConfig extends AdapterConfig {
  apiKey: string;
  /** Override sport key per The Odds API format, e.g. "soccer_epl" */
  sportKeys?: Record<string, string>;
  /** Which bookmaker keys to include. Default: all returned */
  bookmakerFilter?: string[];
  /** Regions to query: "us" | "uk" | "eu" | "au" */
  regions?: string;
  /** Markets: h2h,spreads,totals */
  markets?: string;
}

export class OddsApiAdapter extends BaseAdapter {
  private readonly BASE = "https://api.the-odds-api.com/v4";
  private apiConfig: OddsApiAdapterConfig;
  private remainingRequests: number = -1;

  constructor(config: OddsApiAdapterConfig, onOdds: OddsCallback) {
    super(config, onOdds);
    this.apiConfig = config;
  }

  get bookmakerName() { return "OddsAPI"; }
  get sourceType(): "ASIAN" { return "ASIAN"; }

  async fetchOdds(): Promise<void> {
    const sportKeyGroups = this.apiConfig.sportKeys
      ? this.buildCustomGroups()
      : SPORT_KEY_GROUPS;

    for (const sport of this.config.sports) {
      const keys = sportKeyGroups[sport.toLowerCase()] ?? [];
      if (keys.length === 0) {
        console.warn(`[OddsAPI] No sport keys for: ${sport}`);
        continue;
      }

      let sportUpdates = 0;
      for (const sportKey of keys) {
        try {
          const updates = await this.fetchSportKey(sportKey, sport);
          this.emit(updates);
          sportUpdates += updates.length;
        } catch (err: any) {
          const status = err?.response?.status;
          console.error(`[OddsAPI][${sportKey}] Error: ${err?.response?.data?.message ?? err.message}`);
          if (status === 429) {
            console.warn("[OddsAPI] Rate limited. Backing off 60s.");
            await new Promise((r) => setTimeout(r, 60_000));
          }
          if (status === 422) break; // bad sport key, skip rest
        }
      }

      console.log(`[OddsAPI] ${sport}: ${sportUpdates} updates (remaining: ${this.remainingRequests})`);
    }
  }

  private buildCustomGroups(): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    for (const [sport, key] of Object.entries(this.apiConfig.sportKeys ?? {})) {
      groups[sport] = [key];
    }
    return groups;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async fetchSportKey(sportKey: string, sportLabel: string): Promise<OddsUpdate[]> {
    const regions = this.apiConfig.regions ?? "uk,eu";
    const markets = this.apiConfig.markets ?? "h2h,spreads,totals";

    const res = await axios.get<OddsApiGame[]>(`${this.BASE}/sports/${sportKey}/odds`, {
      params: {
        apiKey: this.apiConfig.apiKey,
        regions,
        markets,
        oddsFormat: "decimal",
      },
      timeout: 10_000,
    });

    this.remainingRequests = parseInt(res.headers["x-requests-remaining"] ?? "-1", 10);
    return this.normalize(res.data, sportLabel);
  }

  private normalize(games: OddsApiGame[], sport: string): OddsUpdate[] {
    const updates: OddsUpdate[] = [];

    for (const game of games) {
      const matchId = `${game.home_team} vs ${game.away_team}`;

      for (const bk of game.bookmakers) {
        // Filter bookmakers if configured
        if (this.apiConfig.bookmakerFilter?.length &&
            !this.apiConfig.bookmakerFilter.includes(bk.key)) {
          continue;
        }

        const sourceType = ASIAN_BOOK_KEYS.has(bk.key) ? "SHARP" : "ASIAN";
        const lastUpdate = new Date(bk.last_update).getTime();

        for (const market of bk.markets) {
          const marketType = this.mapMarket(market.key);
          if (!marketType) continue;
          const line = this.extractLine(market.outcomes);

          for (const outcome of market.outcomes) {
            const outcomeName = this.normalizeOutcome(outcome.name, game.home_team, game.away_team, market.key);
            if (!outcomeName) continue;

            updates.push({
              match_id: matchId,
              sport,
              market: marketType,
              line,
              bookmaker: bk.title,
              source_type: sourceType,
              outcome: outcomeName,
              odds: outcome.price,
              timestamp: lastUpdate,
            });
          }
        }
      }
    }

    return updates;
  }

  private mapMarket(key: string): MarketType | null {
    if (key === "h2h") return "1x2";
    if (key === "totals") return "over_under";
    if (key === "spreads") return "handicap";
    return null;
  }

  private extractLine(outcomes: OddsApiOutcome[]): number {
    // For totals/spreads the `point` field holds the line
    const withPoint = outcomes.find((o) => o.point !== undefined);
    return withPoint?.point ?? 0;
  }

  private normalizeOutcome(
    name: string,
    homeTeam: string,
    awayTeam: string,
    marketKey: string
  ): string | null {
    const n = name.toLowerCase().trim();
    if (n === "over") return "over";
    if (n === "under") return "under";
    if (n === homeTeam.toLowerCase() || n === "home") return "home";
    if (n === awayTeam.toLowerCase() || n === "away") return "away";
    if (n === "draw") return "draw";
    // For spreads, name is the team name
    if (marketKey === "spreads") {
      if (name === homeTeam) return "home";
      if (name === awayTeam) return "away";
    }
    return null;
  }
}
