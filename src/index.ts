import { ArbEngine } from "./engine";
import { OddsUpdate, MarketType, ArbOpportunity } from "./types";

// ─── Pretty Printer ──────────────────────────────────────────────────────────

function printOpp(opp: ArbOpportunity, idx: number): void {
  const prio = opp.is_high_priority ? "🔴 HIGH PRIORITY" : "🟢 Normal";
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  #${idx + 1}  ${prio}`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Match       : ${opp.match}`);
  console.log(`  Market      : ${opp.market}  |  Line: ${opp.line}`);
  console.log(`  Sharp       : ${opp.sharp_bookmaker}  →  ${JSON.stringify(opp.sharp_odds)}`);
  console.log(`  Asian       : ${opp.asian_bookmaker}  →  ${JSON.stringify(opp.asian_odds)}`);
  console.log(`  Arb %       : ${opp.arb_percentage.toFixed(3)}%`);
  console.log(`  Latency Gap : ${opp.latency_gap_ms} ms`);
  console.log(`  Confidence  : ${opp.confidence_score}/100`);
  console.log(`  Stakes      : ${JSON.stringify(opp.recommended_stakes)}`);
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeUpdate(
  match_id: string,
  market: MarketType,
  line: number,
  bookmaker: string,
  source_type: "SHARP" | "ASIAN",
  outcome: string,
  odds: number,
  timestampOffset = 0
): OddsUpdate {
  return {
    match_id,
    sport: "Football",
    market,
    line,
    bookmaker,
    source_type,
    outcome,
    odds,
    timestamp: Date.now() + timestampOffset,
  };
}

// ─── Scenario 1: Over/Under delay exploit ────────────────────────────────────

function scenario1_OverUnder(engine: ArbEngine): void {
  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  SCENARIO 1: Over/Under – SHARP moves, ASIAN lags      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const match = "Man City vs Liverpool";

  // Pinnacle posts initial odds (stable, no arb)
  engine.processUpdate(makeUpdate(match, "over_under", 2.5, "Pinnacle", "SHARP", "over", 1.95));
  engine.processUpdate(makeUpdate(match, "over_under", 2.5, "Pinnacle", "SHARP", "under", 1.90));

  // SABA mirrors (arrived 500ms later, still no arb)
  engine.processUpdate(makeUpdate(match, "over_under", 2.5, "SABA", "ASIAN", "over", 1.92, -500));
  engine.processUpdate(makeUpdate(match, "over_under", 2.5, "SABA", "ASIAN", "under", 1.88, -500));

  // ⚡ Pinnacle SHARP moves Over up sharply — market shift detected
  engine.processUpdate(makeUpdate(match, "over_under", 2.5, "Pinnacle", "SHARP", "over", 2.15));

  // SABA Under hasn't updated yet — still at old odds 1.88
  // But we also need the SABA Under at a price that creates arb with Pinnacle Over 2.15
  //   1/2.15 + 1/X < 1  →  X > 1 / (1 - 1/2.15) = 1 / 0.535 = 1.869
  // SABA Under @1.88 is just above 1.869 → check: 1/2.15 + 1/1.88 = 0.465 + 0.532 = 0.997 < 1  ✅

  // Feed a lagged SABA update (3s old) to simulate the delay window
  const opps = engine.processUpdate(
    makeUpdate(match, "over_under", 2.5, "SABA", "ASIAN", "under", 1.95, -3000)
  );
  // 1/2.15 + 1/1.95 = 0.465 + 0.513 = 0.978 < 1  → arb = 2.2%

  if (opps.length) {
    opps.forEach((o, i) => printOpp(o, i));
  } else {
    console.log("  → No arb found (checking reverse pair)...");
    // The arb may have triggered on the SHARP update instead. Let's re-trigger.
  }
}

// ─── Scenario 2: Handicap across multiple ASIAN books ────────────────────────

function scenario2_Handicap(engine: ArbEngine): void {
  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  SCENARIO 2: Handicap -0.5 – Multiple ASIAN books      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const match = "Arsenal vs Chelsea";

  // Pinnacle SHARP
  engine.processUpdate(makeUpdate(match, "handicap", -0.5, "Pinnacle", "SHARP", "home", 2.20));
  engine.processUpdate(makeUpdate(match, "handicap", -0.5, "Pinnacle", "SHARP", "away", 1.75));

  // CMD (ASIAN) — lagged by 2s, still has generous away odds
  const opps1 = engine.processUpdate(
    makeUpdate(match, "handicap", -0.5, "CMD", "ASIAN", "away", 1.90, -2000)
  );
  // 1/2.20 + 1/1.90 = 0.4545 + 0.5263 = 0.9808 < 1  → arb = 1.9%

  // BTi (ASIAN) — even more lagged, even better odds
  const opps2 = engine.processUpdate(
    makeUpdate(match, "handicap", -0.5, "BTi", "ASIAN", "away", 1.95, -3500)
  );
  // 1/2.20 + 1/1.95 = 0.4545 + 0.5128 = 0.9673 < 1  → arb = 3.3%

  [...opps1, ...opps2].forEach((o, i) => printOpp(o, i));
}

// ─── Scenario 3: 1x2 three-way mix ──────────────────────────────────────────

function scenario3_ThreeWay(engine: ArbEngine): void {
  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  SCENARIO 3: 1x2 Three-Way – Cherry-picking best odds  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const match = "Real Madrid vs Barcelona";

  // Pinnacle SHARP
  engine.processUpdate(makeUpdate(match, "1x2", 0, "Pinnacle", "SHARP", "home", 2.50));
  engine.processUpdate(makeUpdate(match, "1x2", 0, "Pinnacle", "SHARP", "draw", 3.40));
  engine.processUpdate(makeUpdate(match, "1x2", 0, "Pinnacle", "SHARP", "away", 2.90));

  // 8xbet (ASIAN) — juicy draw and away odds (lagged)
  engine.processUpdate(makeUpdate(match, "1x2", 0, "8xbet", "ASIAN", "home", 2.60, -2000));
  engine.processUpdate(makeUpdate(match, "1x2", 0, "8xbet", "ASIAN", "draw", 3.80, -2000));
  const opps = engine.processUpdate(
    makeUpdate(match, "1x2", 0, "8xbet", "ASIAN", "away", 3.20, -2000)
  );
  // Best combo: Pinnacle home 2.50, 8xbet draw 3.80, 8xbet away 3.20
  // 1/2.50 + 1/3.80 + 1/3.20 = 0.400 + 0.263 + 0.3125 = 0.9756 < 1  → arb = 2.4%

  if (opps.length) {
    opps.forEach((o, i) => printOpp(o, i));
  } else {
    console.log("  → No 3-way arb found with current prices.");
  }
}

// ─── Scenario 4: Deduplication & stale eviction ──────────────────────────────

function scenario4_Dedup(engine: ArbEngine): void {
  console.log("\n\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  SCENARIO 4: Dedup & Stale – Same odds ignored          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const match = "PSG vs Bayern";

  // Feed same odds twice — second should be deduped (returns [])
  const r1 = engine.processUpdate(
    makeUpdate(match, "over_under", 3.5, "Pinnacle", "SHARP", "over", 2.00)
  );
  const r2 = engine.processUpdate(
    makeUpdate(match, "over_under", 3.5, "Pinnacle", "SHARP", "over", 2.00)
  );

  console.log(`  First update returned ${r1.length} opps (expected 0 — no counterpart yet)`);
  console.log(`  Duplicate update returned ${r2.length} opps (expected 0 — deduped)`);

  // Stale test: feed an odds that's already 6s old
  const r3 = engine.processUpdate(
    makeUpdate(match, "over_under", 3.5, "SABA", "ASIAN", "under", 2.10, -6000)
  );
  console.log(`  Stale ASIAN update (6s old) returned ${r3.length} opps (expected 0 — evicted on read)`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     REAL-TIME ARBITRAGE DETECTION ENGINE — SIMULATION   ║");
  console.log("║     Bankroll: $5,000                                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const engine = new ArbEngine({ bankroll: 5000 });

  scenario1_OverUnder(engine);
  scenario2_Handicap(engine);
  scenario3_ThreeWay(engine);
  scenario4_Dedup(engine);

  console.log(`\n\n📊 Store size after all scenarios: ${engine.storeSize} entries`);
  console.log("Done.\n");
}

main();
