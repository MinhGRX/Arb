/**
 * Targeted fetch for LCK (League ID 192553) to find KT vs DK.
 * Run: npx ts-node src/adapters/test-full-odds-v3.ts
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
  const LCK_ID = 192553;
  
  console.log(`📡 Fetching matchups for League ID: ${LCK_ID}...`);
  const matchupsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/matchups?brandId=0`, { headers: HEADERS });
  
  matchupsRes.data.forEach((m: any) => {
    console.log(`   - [${m.id}] ${m.participants[0].name} vs ${m.participants[1].name}`);
  });

  const targetMatch = matchupsRes.data.find((m: any) => 
    m.participants.some((p: any) => p.name.toLowerCase().includes("kt rolster") || p.name.toLowerCase().includes("dplus"))
  );

  if (!targetMatch) {
    console.log("❌ Target match not found.");
    return;
  }

  const mId = targetMatch.id;
  console.log(`\n✅ Found Match ID: ${mId}`);

  console.log("📡 Fetching ALL Markets...");
  const marketsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/markets/straight?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
  
  if (!marketsRes.data || !Array.isArray(marketsRes.data)) {
    console.log("⚠️ No straight markets found (Empty or 204 No Content).");
    return;
  }

  const rows = marketsRes.data.flatMap((mkt: any) => 
    mkt.prices.map((p: any) => ({
      Period: mkt.period === 0 ? "Full" : `Map ${mkt.period}`,
      Type: mkt.type,
      Key: mkt.key,
      Outcome: p.designation,
      Line: p.points ?? "-",
      Odds: p.price
    }))
  );

  rows.sort((a: any, b: any) => (a.Period === "Full" ? -1 : 1) || a.Type.localeCompare(b.Type));
  console.table(rows);
}

fetchAll().catch(err => console.error(err.message));
