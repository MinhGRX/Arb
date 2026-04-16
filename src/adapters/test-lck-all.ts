/**
 * Fetch EVERYTHING for ALL upcoming LCK matches.
 * Run: npx ts-node src/adapters/test-lck-all.ts
 */
import axios from "axios";

const HEADERS = {
  "X-Device-UUID": "guest",
  "Referer": "https://www.pinnacle.com/",
  "Origin": "https://www.pinnacle.com",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

async function fetchAllLCK() {
  const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
  const LCK_ID = 192553;
  
  console.log(`📡 Fetching LCK Matchups (League ID: ${LCK_ID})...`);
  const matchupsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/matchups?brandId=0`, { headers: HEADERS });
  
  // Filter for real matches (not props like Over/Under total kills if possible, though they have same league)
  // Real matches usually have 2 participants with team names.
  const realMatches = matchupsRes.data.filter((m: any) => 
    m.participants.length === 2 && 
    !m.participants[0].name.includes(" vs ") &&
    !["Yes", "No", "Over", "Under", "Odd", "Even"].includes(m.participants[0].name)
  );

  if (realMatches.length === 0) {
    console.log("❌ No upcoming LCK matches found.");
    return;
  }

  console.log(`✅ Found ${realMatches.length} upcoming/live LCK matches.\n`);

  for (const match of realMatches) {
    const mId = match.id;
    const name = `${match.participants[0].name} vs ${match.participants[1].name}`;
    console.log(`\n🔥 ODDS FOR: ${name} (ID: ${mId})`);
    
    try {
      const marketsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/markets/straight?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
      
      if (!marketsRes.data || !Array.isArray(marketsRes.data) || marketsRes.data.length === 0) {
        console.log("   ⚠️ No straight markets available right now.");
        continue;
      }

      const rows = marketsRes.data.flatMap((mkt: any) => 
        mkt.prices.map((p: any) => ({
          Period: mkt.period === 0 ? "Full" : `Map ${mkt.period}`,
          Type: mkt.type,
          Outcome: p.designation,
          Line: p.points ?? "-",
          Odds: p.price
        }))
      );

      rows.sort((a: any, b: any) => (a.Period === "Full" ? -1 : 1) || a.Type.localeCompare(b.Type));
      console.table(rows);
    } catch (err: any) {
      console.log(`   ❌ Failed to fetch markets for ${name}: ${err.message}`);
    }
  }
}

fetchAllLCK().catch(err => console.error(err.message));
