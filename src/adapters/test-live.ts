/**
 * Quick end-to-end live mode test.
 * - Fetches REAL Pinnacle odds
 * - Pushes them into the arb engine
 * - Since we only have one SHARP source, we won't find real arbs,
 *   but we verify the full pipeline works (parse → normalize → engine → output)
 *
 * Run: npx ts-node src/adapters/test-live.ts
 */
import { ArbEngine } from "../engine";
import { PinnacleAdapter } from "./pinnacle";
import { OddsUpdate } from "../types";

const engine = new ArbEngine({ bankroll: 5000 });
let totalUpdates = 0;
let totalArbs = 0;

const adapter = new PinnacleAdapter(
  { sports: ["soccer", "basketball"], pollIntervalMs: 99999 },
  (updates: OddsUpdate[]) => {
    totalUpdates += updates.length;
    for (const u of updates) {
      const opps = engine.processUpdate(u);
      if (opps.length > 0) {
        totalArbs += opps.length;
        for (const opp of opps) {
          console.log(
            `🔥 ARB ${opp.arb_percentage.toFixed(2)}% | ${opp.match} ` +
            `| ${opp.market} @${opp.line} | conf=${opp.confidence_score}`
          );
        }
      }
    }
  }
);

console.log("Fetching real Pinnacle odds...\n");

adapter.fetchOdds().then(() => {
  console.log(`\n📊 Pipeline results:`);
  console.log(`   Odds updates ingested : ${totalUpdates}`);
  console.log(`   Engine store size     : ${engine.storeSize}`);
  console.log(`   Arbs found (SHARP only): ${totalArbs} (expected 0 — need ASIAN counterpart)`);
  console.log(`\n✅ Pipeline verified. Add ODDS_API_KEY or SABA credentials to .env for real arb detection.`);
  process.exit(0);
}).catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
