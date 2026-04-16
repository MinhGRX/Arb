/**
 * Official view for LCK odds using the production PinnacleAdapter.
 */
import { PinnacleAdapter } from "./adapters/pinnacle";

const adapter = new PinnacleAdapter(
  { sports: ["esports"], leagueNameFilter: ["lck"], pollIntervalMs: 10000 },
  (updates) => {
    if (updates.length === 0) {
      console.log("No LCK odds found at this moment.");
      return;
    }

    console.log(`\n✅ Successfully fetched ${updates.length} LCK odds updates.\n`);
    
    // Group by Match
    const matches: Record<string, any[]> = {};
    updates.forEach(u => {
      if (!matches[u.match_id]) matches[u.match_id] = [];
      matches[u.match_id].push(u);
    });

    for (const [name, odds] of Object.entries(matches)) {
      console.log(`🔥 Match: ${name}`);
      const table = odds.map(o => ({
        Period: o.period === 0 ? "Full" : `Map ${o.period}`,
        Market: o.market,
        Outcome: o.outcome,
        Line: o.line,
        Odds: o.odds
      })).sort((a,b) => (a.Period === "Full" ? -1 : 1) || a.Market.localeCompare(b.Market));
      console.table(table);
      console.log("\n");
    }
    process.exit(0);
  }
);

console.log("Connecting to Pinnacle for LCK Live updates...");
adapter.fetchOdds().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
