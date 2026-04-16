/**
 * Fetch ABSOLUTELY EVERYTHING for KT vs DK with fixed headers.
 * Run: npx ts-node src/adapters/test-full-odds-v2.ts
 */
import axios from "axios";

const HEADERS = {
  "X-Device-UUID": "guest",
  "Referer": "https://www.pinnacle.com/",
  "Origin": "https://www.pinnacle.com",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

async function fetchAll() {
  const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
  
  console.log("📡 Step 1: Searching for KT vs DK in LCK...");
  const matchupsRes = await axios.get(`${BASE}/sports/12/matchups?brandId=0`, { headers: HEADERS });
  
  const targetMatch = matchupsRes.data.find((m: any) => 
    m.league.name.toLowerCase().includes("lck") &&
    m.participants.some((p: any) => p.name.toLowerCase().includes("kt rolster"))
  );

  if (!targetMatch) {
    console.log("❌ Match not found in Live/Upcoming LCK feed.");
    return;
  }

  const mId = targetMatch.id;
  const leagueId = targetMatch.league.id;
  console.log(`✅ Found: ${targetMatch.participants[0].name} vs ${targetMatch.participants[1].name} (ID: ${mId})`);

  console.log("\n📡 Step 2: Fetching ALL Markets (Straight)...");
  const marketsRes = await axios.get(`${BASE}/leagues/${leagueId}/markets/straight?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
  
  const matchMarkets = marketsRes.data;
  console.log(`📊 Found ${matchMarkets.length} market records for this specific ID.\n`);

  // Format and Display
  const rows: any[] = [];
  matchMarkets.forEach((mkt: any) => {
    mkt.prices.forEach((p: any) => {
      rows.push({
        Period: mkt.period === 0 ? "Full" : `Map ${mkt.period}`,
        Type: mkt.type,
        Designation: p.designation,
        Line: p.points !== undefined ? p.points : "-",
        Price: p.price,
        Key: mkt.key
      });
    });
  });

  // Sort: Full Match first, then by type
  rows.sort((a, b) => {
    if (a.Period !== b.Period) return a.Period === "Full" ? -1 : 1;
    return a.Type.localeCompare(b.Type);
  });

  console.table(rows);
}

fetchAll().catch(err => {
  console.error("❌ Error fetching data:", err.response?.data || err.message);
});
