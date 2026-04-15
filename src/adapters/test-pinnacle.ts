/**
 * Quick smoke test — fetches real Pinnacle odds and prints first 5 updates.
 * Run: npx ts-node src/adapters/test-pinnacle.ts
 */
import { PinnacleAdapter } from "./pinnacle";

const adapter = new PinnacleAdapter(
  { sports: ["soccer"], pollIntervalMs: 99999, leagueIds: [] },
  (updates) => {
    console.log(`\n✅ Got ${updates.length} odds updates from Pinnacle\n`);
    updates.slice(0, 5).forEach((u) => {
      console.log(`  ${u.market.padEnd(12)} | line=${String(u.line).padEnd(6)} | ${u.outcome.padEnd(6)} | odds=${u.odds} | ${u.match_id}`);
    });
    if (updates.length > 5) console.log(`  ... and ${updates.length - 5} more`);
    process.exit(0);
  }
);

console.log("Fetching Pinnacle soccer odds...");
adapter.fetchOdds().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});

setTimeout(() => { console.error("❌ Timeout"); process.exit(1); }, 20000);
