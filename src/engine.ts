import {
  OddsUpdate,
  ArbOpportunity,
  MarketType,
  EngineConfig,
  DEFAULT_CONFIG,
} from "./types";
import { OddsStore } from "./store";

/**
 * Real-time arbitrage detection engine.
 *
 * Design:
 *  - Each `processUpdate()` call ingests one odds tick and returns any new arb
 *    opportunities it creates against the current state.
 *  - Only SHARP × ASIAN pairs are evaluated (ASIAN × ASIAN is ignored).
 *  - Stale odds (>staleThresholdMs) are automatically evicted on read.
 *  - High-priority flag is set when SHARP moved within the delay window
 *    and the ASIAN side is still lagging.
 */
export class ArbEngine {
  private store: OddsStore;
  private config: EngineConfig;

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.store = new OddsStore();
  }

  // ─── Public ──────────────────────────────────────────────────────────────

  /**
   * Ingest a single odds update and return any arb opportunities it triggers.
   * Designed for real-time streaming: call this on every WebSocket tick.
   */
  processUpdate(update: OddsUpdate): ArbOpportunity[] {
    const mutated = this.store.upsert(update);
    if (!mutated) return [];
    return this.detectArbs(update);
  }

  /** Expose store size for monitoring */
  get storeSize(): number {
    return this.store.size;
  }

  /** Update bankroll at runtime */
  setBankroll(b: number): void {
    this.config.bankroll = b;
  }

  // ─── Detection ───────────────────────────────────────────────────────────

  private detectArbs(trigger: OddsUpdate): ArbOpportunity[] {
    const odds = this.store.getGroup(
      trigger.match_id,
      trigger.market,
      trigger.line,
      this.config.staleThresholdMs
    );

    let opps: ArbOpportunity[];
    if (trigger.market === "1x2") {
      opps = this.scan3Way(odds);
    } else {
      opps = this.scan2Way(odds, trigger.market);
    }

    // Filter by minimum arb %
    if (this.config.minArbPercentage > 0) {
      opps = opps.filter((o) => o.arb_percentage >= this.config.minArbPercentage);
    }

    // Sort: arb_percentage DESC, latency_gap DESC
    opps.sort((a, b) => {
      const d = b.arb_percentage - a.arb_percentage;
      return d !== 0 ? d : b.latency_gap_ms - a.latency_gap_ms;
    });

    return opps.slice(0, this.config.maxOpportunities);
  }

  // ─── 2-Way (Over/Under, Handicap) ────────────────────────────────────────

  private scan2Way(odds: OddsUpdate[], market: MarketType): ArbOpportunity[] {
    const [out1, out2] =
      market === "over_under" ? ["over", "under"] : ["home", "away"];

    const sharps1 = odds.filter((o) => o.source_type === "SHARP" && o.outcome === out1);
    const sharps2 = odds.filter((o) => o.source_type === "SHARP" && o.outcome === out2);
    const asians1 = odds.filter((o) => o.source_type === "ASIAN" && o.outcome === out1);
    const asians2 = odds.filter((o) => o.source_type === "ASIAN" && o.outcome === out2);

    const opps: ArbOpportunity[] = [];

    // SHARP(out1) vs ASIAN(out2)
    for (const s of sharps1) {
      for (const a of asians2) {
        this.evaluate2Way(s, a, out1, out2, opps);
      }
    }
    // SHARP(out2) vs ASIAN(out1)
    for (const s of sharps2) {
      for (const a of asians1) {
        this.evaluate2Way(a, s, out1, out2, opps);
      }
    }

    return opps;
  }

  private evaluate2Way(
    side1: OddsUpdate,  // outcome1 side
    side2: OddsUpdate,  // outcome2 side
    out1: string,
    out2: string,
    opps: ArbOpportunity[]
  ): void {
    // Must be SHARP vs ASIAN
    if (side1.source_type === side2.source_type) return;

    const arbFactor = 1 / side1.odds + 1 / side2.odds;
    if (arbFactor >= 1) return; // No arb

    const sharp = side1.source_type === "SHARP" ? side1 : side2;
    const asian = side1.source_type === "ASIAN" ? side1 : side2;

    const arb_percentage = (1 - arbFactor) * 100;
    const latency_gap_ms = Math.abs(sharp.timestamp - asian.timestamp);
    const is_high_priority = this.isHighPriority(sharp, asian);

    const stakes = this.calcStakes({ [out1]: side1.odds, [out2]: side2.odds });

    opps.push({
      match: side1.match_id,
      market: side1.market,
      line: side1.line,
      sharp_bookmaker: sharp.bookmaker,
      asian_bookmaker: asian.bookmaker,
      sharp_odds: { [sharp.outcome]: sharp.odds },
      asian_odds: { [asian.outcome]: asian.odds },
      arb_percentage,
      latency_gap_ms,
      recommended_stakes: stakes,
      confidence_score: this.calcConfidence(latency_gap_ms, arb_percentage, is_high_priority),
      is_high_priority,
      detected_at: Date.now(),
    });
  }

  // ─── 3-Way (1x2) ─────────────────────────────────────────────────────────

  private scan3Way(odds: OddsUpdate[]): ArbOpportunity[] {
    const groups: Record<string, OddsUpdate[]> = { home: [], draw: [], away: [] };
    for (const o of odds) {
      if (o.outcome in groups) groups[o.outcome]!.push(o);
    }

    const opps: ArbOpportunity[] = [];

    for (const h of groups.home!) {
      for (const d of groups.draw!) {
        for (const a of groups.away!) {
          // Must involve both SHARP and ASIAN
          const types = new Set([h.source_type, d.source_type, a.source_type]);
          if (!types.has("SHARP") || !types.has("ASIAN")) continue;

          const arbFactor = 1 / h.odds + 1 / d.odds + 1 / a.odds;
          if (arbFactor >= 1) continue;

          const legs = [h, d, a];
          const sharp = legs.find((l) => l.source_type === "SHARP")!;
          const asian = legs.find((l) => l.source_type === "ASIAN")!;

          const arb_percentage = (1 - arbFactor) * 100;
          const timestamps = legs.map((l) => l.timestamp);
          const latency_gap_ms = Math.max(...timestamps) - Math.min(...timestamps);
          const is_high_priority = this.isHighPriority(sharp, asian);

          const oddsMap = { home: h.odds, draw: d.odds, away: a.odds };
          const stakes = this.calcStakes(oddsMap);

          opps.push({
            match: h.match_id,
            market: h.market,
            line: h.line,
            sharp_bookmaker: sharp.bookmaker,
            asian_bookmaker: asian.bookmaker,
            sharp_odds: legs
              .filter((l) => l.source_type === "SHARP")
              .reduce((acc, l) => ({ ...acc, [l.outcome]: l.odds }), {} as Record<string, number>),
            asian_odds: legs
              .filter((l) => l.source_type === "ASIAN")
              .reduce((acc, l) => ({ ...acc, [l.outcome]: l.odds }), {} as Record<string, number>),
            arb_percentage,
            latency_gap_ms,
            recommended_stakes: stakes,
            confidence_score: this.calcConfidence(latency_gap_ms, arb_percentage, is_high_priority),
            is_high_priority,
            detected_at: Date.now(),
          });
        }
      }
    }

    return opps;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * High priority = SHARP moved very recently AND ASIAN hasn't caught up.
   */
  private isHighPriority(sharp: OddsUpdate, asian: OddsUpdate): boolean {
    const now = Date.now();
    return (
      now - sharp.timestamp < this.config.delayPriorityMs &&
      asian.timestamp < sharp.timestamp
    );
  }

  /**
   * Stake calculation:
   *   stake_i = (B / odds_i) / Σ(1/odds_j)
   * This guarantees equal profit regardless of outcome.
   */
  private calcStakes(oddsMap: Record<string, number>): Record<string, number> {
    const entries = Object.entries(oddsMap);
    const sumInv = entries.reduce((s, [, o]) => s + 1 / o, 0);
    const stakes: Record<string, number> = {};
    for (const [outcome, odds] of entries) {
      stakes[outcome] = Math.round(((this.config.bankroll / odds) / sumInv) * 100) / 100;
    }
    return stakes;
  }

  /**
   * Confidence score 0–100.
   *  - Latency component (0-40): larger gap = ASIAN more likely still exploitable
   *  - Arb %    component (0-40): bigger margin = more profit buffer
   *  - Priority component (0-20): high-priority gets a bonus
   */
  private calcConfidence(
    latencyMs: number,
    arbPct: number,
    highPriority: boolean
  ): number {
    const latencyScore = Math.min(latencyMs / 2000, 1) * 40;
    const arbScore = Math.min(arbPct / 5, 1) * 40;
    const priorityBonus = highPriority ? 20 : 0;
    return Math.round(latencyScore + arbScore + priorityBonus);
  }
}
