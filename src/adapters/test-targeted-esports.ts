/**
 * Test: Fetching LoL, Dota 2, and CS2 explicitly from Pinnacle.
 * Run: npx ts-node src/adapters/test-targeted-esports.ts
 */
import { PinnacleAdapter } from "./pinnacle";

const adapter = new PinnacleAdapter(
  { 
    sports: ["esports"], 
    pollIntervalMs: 99999, 
    leagueNameFilter: ["league of legends", "dota 2", "cs2", "csgo", "valorant"] 
  },
  (updates) => {
    console.log(`\n✅ Got ${updates.length} targeted eSports updates from Pinnacle\n`);
    
    // Group by match to show variety
    const matches = new Set(updates.map(u => u.match_id));
    console.log(`📡 Matches found (${matches.size}):`);
    Array.from(matches).slice(0, 5).forEach(m => console.log(`   - ${m}`));
    
    process.exit(0);
  }
);

console.log("Fetching Targeted eSports (LoL, Dota 2, CS2)...");
adapter.fetchOdds().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});

setTimeout(() => { console.error("❌ Timeout"); process.exit(1); }, 20000);
