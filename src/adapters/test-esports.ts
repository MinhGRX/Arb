/**
 * Smoke test for Pinnacle Esports.
 * Run: npx ts-node src/adapters/test-esports.ts
 */
import { PinnacleAdapter } from "./pinnacle";

const adapter = new PinnacleAdapter(
  { sports: ["esports"], pollIntervalMs: 99999, leagueIds: [] },
  (updates) => {
    console.log(`\n✅ Got ${updates.length} eSports updates from Pinnacle\n`);
    updates.slice(0, 10).forEach((u) => {
      console.log(`  ${u.market.padEnd(12)} | line=${String(u.line).padEnd(6)} | ${u.outcome.padEnd(10)} | odds=${u.odds} | ${u.match_id}`);
    });
    process.exit(0);
  }
);

console.log("Fetching Pinnacle eSports odds...");
adapter.fetchOdds().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});

setTimeout(() => { console.error("❌ Timeout"); process.exit(1); }, 20000);
