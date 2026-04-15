/**
 * Specific test for KT vs DK (LCK) odds.
 * Run: npx ts-node src/adapters/test-kt-dk.ts
 */
import { PinnacleAdapter } from "./pinnacle";

const adapter = new PinnacleAdapter(
  { 
    sports: ["esports"], 
    pollIntervalMs: 99999, 
    leagueNameFilter: ["lck"] 
  },
  (updates) => {
    // Filter specifically for KT vs Dplus KIA
    const targetMatch = updates.filter(u => 
      u.match_id.toLowerCase().includes("kt rolster") || 
      u.match_id.toLowerCase().includes("dplus")
    );

    if (targetMatch.length === 0) {
      console.log("\n❌ Match 'KT vs DK' not found in current LCK feed.");
      process.exit(1);
    }

    console.log(`\n🔥 ALL ODDS FOR: ${targetMatch[0].match_id}\n`);
    console.log(`  ${"MARKET".padEnd(15)} | ${"LINE".padEnd(8)} | ${"OUTCOME".padEnd(10)} | ${"ODDS"}`);
    console.log(`  ${"-".repeat(15)}-+-${"-".repeat(8)}-+-${"-".repeat(10)}-+-${"-".repeat(5)}`);

    // Sort by market and line for readability
    targetMatch.sort((a,b) => a.market.localeCompare(b.market) || a.line - b.line)
      .forEach((u) => {
        console.log(`  ${u.market.padEnd(15)} | ${String(u.line).padEnd(8)} | ${u.outcome.padEnd(10)} | ${u.odds}`);
      });

    console.log(`\nTotal updates for this match: ${targetMatch.length}`);
    process.exit(0);
  }
);

console.log("Searching LCK matches for KT vs DK...");
adapter.fetchOdds().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});

setTimeout(() => { console.error("❌ Timeout"); process.exit(1); }, 20000);
