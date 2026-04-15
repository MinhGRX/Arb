import WebSocket from "ws";
import { OddsUpdate, MarketType } from "./types";

/**
 * Demo client that:
 *  1. Connects to /feed and pumps fake odds updates
 *  2. Connects to /subscribe and prints arb alerts
 */

const SERVER = process.env.SERVER || "ws://localhost:8080";

// ─── Subscriber (receives arb alerts) ────────────────────────────────────────

const sub = new WebSocket(`${SERVER}/subscribe`);

sub.on("open", () => console.log("[SUB] Connected to /subscribe"));
sub.on("message", (raw) => {
  const data = JSON.parse(raw.toString());
  if (data.type === "arb") {
    console.log(`\n[SUB] 🔥 Received ${data.opportunities.length} arb(s):`);
    for (const opp of data.opportunities) {
      const prio = opp.is_high_priority ? "🔴" : "🟢";
      console.log(`  ${prio} ${opp.arb_percentage.toFixed(2)}% | ${opp.match} | ${opp.sharp_bookmaker} vs ${opp.asian_bookmaker} | conf=${opp.confidence_score}`);
      console.log(`     Stakes: ${JSON.stringify(opp.recommended_stakes)}`);
    }
  }
});

// ─── Feed Producer (sends odds updates) ──────────────────────────────────────

const feed = new WebSocket(`${SERVER}/feed`);

feed.on("open", () => {
  console.log("[FEED] Connected to /feed — starting simulation...\n");
  runFeedSimulation();
});

function send(update: OddsUpdate): void {
  feed.send(JSON.stringify(update));
}

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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runFeedSimulation() {
  // ── Phase 1: Stable odds (no arb) ──────────────────────────────────────
  console.log("[FEED] Phase 1: Sending stable odds...");

  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "Pinnacle", "SHARP", "home", 1.85));
  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "Pinnacle", "SHARP", "away", 2.00));
  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "SABA", "ASIAN", "home", 1.83));
  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "SABA", "ASIAN", "away", 1.97));

  await sleep(1500);

  // ── Phase 2: Pinnacle moves, SABA lags → ARB ──────────────────────────
  console.log("[FEED] Phase 2: Pinnacle moves Home to 2.15 — SABA still lagging...");

  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "Pinnacle", "SHARP", "home", 2.15));
  // SABA Away still at 1.97 (3s old data)
  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "SABA", "ASIAN", "away", 1.97, -3000));
  // 1/2.15 + 1/1.97 = 0.465 + 0.508 = 0.973 → arb = 2.7%

  await sleep(2000);

  // ── Phase 3: Multiple ASIAN books, different lags ──────────────────────
  console.log("[FEED] Phase 3: CMD and BTi also lagging...");

  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "CMD", "ASIAN", "away", 2.00, -2500));
  // 1/2.15 + 1/2.00 = 0.465 + 0.500 = 0.965 → arb = 3.5%

  send(makeUpdate("Arsenal vs Chelsea", "handicap", -0.5, "BTi", "ASIAN", "away", 2.05, -4000));
  // 1/2.15 + 1/2.05 = 0.465 + 0.488 = 0.953 → arb = 4.7%

  await sleep(2000);

  // ── Phase 4: Over/Under on a different match ───────────────────────────
  console.log("[FEED] Phase 4: New match — Over/Under...");

  send(makeUpdate("PSG vs Bayern", "over_under", 3.5, "Pinnacle", "SHARP", "over", 2.25));
  send(makeUpdate("PSG vs Bayern", "over_under", 3.5, "Pinnacle", "SHARP", "under", 1.70));
  send(makeUpdate("PSG vs Bayern", "over_under", 3.5, "8xbet", "ASIAN", "under", 1.85, -1500));
  // 1/2.25 + 1/1.85 = 0.444 + 0.541 = 0.985 → arb = 1.5%

  await sleep(2000);

  console.log("\n[FEED] Simulation done. Closing in 3s...");
  await sleep(3000);

  feed.close();
  sub.close();
  process.exit(0);
}
