import axios from "axios";
import { OddsUpdate } from "../types";
import { BaseAdapter, AdapterConfig, OddsCallback } from "./base";

// ─── Pinnacle Sport IDs ───────────────────────────────────────────────────────

export const PINNACLE_SPORT_IDS: Record<string, number> = {
  soccer: 29,
  basketball: 4,
  esports: 12,
  tennis: 33,
  americanfootball: 15,
  baseball: 3,
  icehockey: 19,
};

// ─── Raw response types ───────────────────────────────────────────────────────

interface PinnacleMatchup {
  id: number;
  isLive: boolean;
  league: { id: number; name: string };
  participants: Array<{ alignment: "home" | "away"; name: string }>;
  periods: Array<{ period: number; status: string }>;
}

interface PinnacleMarket {
  matchupId: number;
  type: string;     // "moneyline" | "spread" | "total" | "team_total"
  period: number;   // 0 = full match, 1 = 1st half
  status: string;   // "open"
  isAlternate: boolean;
  prices: Array<{
    designation: "home" | "away" | "draw" | "over" | "under";
    price: number;  // American odds
    points?: number;
  }>;
}

// ─── Odds Conversion ─────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american >= 100) return parseFloat((american / 100 + 1).toFixed(3));
  if (american <= -100) return parseFloat((100 / Math.abs(american) + 1).toFixed(3));
  return 0; // invalid
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class PinnacleAdapter extends BaseAdapter {
  private readonly BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
  private readonly HEADERS = {
    "X-Device-UUID": "guest",
    "Accept": "application/json",
    "Referer": "https://www.pinnacle.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  constructor(config: AdapterConfig, onOdds: OddsCallback) {
    super(config, onOdds);
  }

  get bookmakerName() { return "Pinnacle"; }
  get sourceType(): "SHARP" { return "SHARP"; }

  // ── Main fetch ─────────────────────────────────────────────────────────────

  async fetchOdds(): Promise<void> {
    for (const sport of this.config.sports) {
      const sportId = PINNACLE_SPORT_IDS[sport.toLowerCase()];
      if (!sportId) {
        console.warn(`[Pinnacle] Unknown sport: ${sport}`);
        continue;
      }
      try {
        const updates = await this.fetchSport(sportId, sport);
        this.emit(updates);
        console.log(`[Pinnacle] ${sport}: ${updates.length} updates from ${this.countMatches(updates)} matches`);
      } catch (err: any) {
        console.error(`[Pinnacle][${sport}] Error: ${err.message}`);
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async fetchSport(sportId: number, sport: string): Promise<OddsUpdate[]> {
    // Step 1: Get league list
    const leaguesRes = await axios.get<Array<{ id: number; name: string; matchupCount: number }>>(
      `${this.BASE}/sports/${sportId}/leagues?all=false&brandId=0`,
      { headers: this.HEADERS, timeout: 8000 }
    );

    // Initial filter: must have matchups
    let leagues = leaguesRes.data.filter((l) => l.matchupCount > 0);
    
    // Filter by ID if provided
    if (this.config.leagueIds?.length) {
      leagues = leagues.filter((l) => this.config.leagueIds!.includes(String(l.id)));
    } 
    // Filter by Name Keywords if provided
    else if (this.config.leagueNameFilter?.length) {
      const keywords = this.config.leagueNameFilter.map(k => k.toLowerCase());
      leagues = leagues.filter((l) => 
        keywords.some(k => l.name.toLowerCase().includes(k))
      );
    }
    // Otherwise take top 10 (expanded from 8 to catch more matches)
    else {
      leagues = leagues.sort((a, b) => b.matchupCount - a.matchupCount).slice(0, 10);
    }

    // Step 2: Fetch matchups + markets in parallel per league
    const results = await Promise.allSettled(
      leagues.map((l) => this.fetchLeague(l.id, sport))
    );

    const updates: OddsUpdate[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") updates.push(...r.value);
    }
    return updates;
  }

  private async fetchLeague(leagueId: number, sport: string): Promise<OddsUpdate[]> {
    const [matchupsRes, marketsRes] = await Promise.all([
      axios.get<PinnacleMatchup[]>(
        `${this.BASE}/leagues/${leagueId}/matchups`,
        { headers: this.HEADERS, timeout: 8000 }
      ),
      axios.get<PinnacleMarket[]>(
        `${this.BASE}/leagues/${leagueId}/markets/straight`,
        { headers: this.HEADERS, timeout: 8000 }
      ),
    ]);

    // Index matchups by id for O(1) lookup
    const matchupMap = new Map<number, PinnacleMatchup>();
    for (const m of matchupsRes.data) {
      if (!m.isLive) matchupMap.set(m.id, m);
    }

    return this.normalize(marketsRes.data, matchupMap, sport);
  }

  private normalize(
    markets: PinnacleMarket[],
    matchupMap: Map<number, PinnacleMatchup>,
    sport: string
  ): OddsUpdate[] {
    const updates: OddsUpdate[] = [];
    const now = Date.now();

    for (const mkt of markets) {
      // Full-match only, open, non-alternate
      if (mkt.period !== 0 || mkt.status !== "open" || mkt.isAlternate) continue;

      const matchup = matchupMap.get(mkt.matchupId);
      if (!matchup) continue;

      const home = matchup.participants.find((p) => p.alignment === "home")?.name ?? "Home";
      const away = matchup.participants.find((p) => p.alignment === "away")?.name ?? "Away";
      const matchId = `${home} vs ${away}`;

      if (mkt.type === "moneyline") {
        for (const price of mkt.prices) {
          const dec = americanToDecimal(price.price);
          if (dec <= 1) continue;
          updates.push(this.makeUpdate(matchId, sport, "1x2", 0, price.designation, dec, now));
        }
      }

      if (mkt.type === "total") {
        for (const price of mkt.prices) {
          const line = price.points ?? 0;
          const dec = americanToDecimal(price.price);
          if (dec <= 1) continue;
          updates.push(this.makeUpdate(matchId, sport, "over_under", line, price.designation, dec, now));
        }
      }

      if (mkt.type === "spread") {
        for (const price of mkt.prices) {
          const line = price.points ?? 0;
          const dec = americanToDecimal(price.price);
          if (dec <= 1) continue;
          updates.push(this.makeUpdate(matchId, sport, "handicap", line, price.designation, dec, now));
        }
      }
    }

    return updates;
  }

  private makeUpdate(
    matchId: string, sport: string,
    market: "1x2" | "over_under" | "handicap",
    line: number, outcome: string, odds: number, timestamp: number
  ): OddsUpdate {
    return { match_id: matchId, sport, market, line, bookmaker: this.bookmakerName, source_type: "SHARP", outcome, odds, timestamp };
  }

  private countMatches(updates: OddsUpdate[]): number {
    return new Set(updates.map((u) => u.match_id)).size;
  }
}
