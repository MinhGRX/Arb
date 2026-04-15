// ─── Market & Source Types ───────────────────────────────────────────────────

export type MarketType = "1x2" | "over_under" | "handicap";
export type SourceType = "SHARP" | "ASIAN";

// ─── Known Bookmakers ────────────────────────────────────────────────────────

export const SHARP_BOOKMAKERS = ["Pinnacle"] as const;
export const ASIAN_BOOKMAKERS = ["SABA", "CMD", "BTi", "8xbet", "TF Gaming"] as const;

export type SharpBookmaker = typeof SHARP_BOOKMAKERS[number];
export type AsianBookmaker = typeof ASIAN_BOOKMAKERS[number];

// ─── Inbound Odds Update ─────────────────────────────────────────────────────

export interface OddsUpdate {
  match_id: string;
  sport: string;
  market: MarketType;
  line: number;
  bookmaker: string;
  source_type: SourceType;
  outcome: string; // home | away | draw | over | under
  odds: number;
  timestamp: number; // epoch ms
}

// ─── Detected Opportunity ────────────────────────────────────────────────────

export interface ArbOpportunity {
  match: string;
  market: MarketType;
  line: number;
  sharp_bookmaker: string;
  asian_bookmaker: string;
  sharp_odds: Record<string, number>;   // outcome -> odds
  asian_odds: Record<string, number>;   // outcome -> odds
  arb_percentage: number;               // positive means profitable
  latency_gap_ms: number;
  recommended_stakes: Record<string, number>; // outcome -> stake $
  confidence_score: number;             // 0-100
  is_high_priority: boolean;
  detected_at: number;                  // epoch ms
}

// ─── Engine Config ───────────────────────────────────────────────────────────

export interface EngineConfig {
  bankroll: number;
  staleThresholdMs: number;     // drop odds older than this (default 5000)
  delayPriorityMs: number;      // SHARP move within this window = high prio (default 2000)
  minArbPercentage: number;     // filter noise (default 0)
  maxOpportunities: number;     // cap output per tick (default 50)
}

export const DEFAULT_CONFIG: EngineConfig = {
  bankroll: 1000,
  staleThresholdMs: 5000,
  delayPriorityMs: 2000,
  minArbPercentage: 0,
  maxOpportunities: 50,
};
