/**
 * Fetch ABSOLUTELY EVERYTHING Pinnacle returns for KT vs DK.
 * Removes all filters for period, market type, and alternate lines.
 * Run: npx ts-node src/adapters/test-all-odds.ts
 */
import axios from "axios";

async function fetchAll() {
  const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
  const HEADERS = {
    "X-Device-UUID": "guest",
    "Accept": "application/json",
    "Referer": "https://www.pinnacle.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  const LCK_LEAGUE_ID = 241151; // Targeted LCK league ID from previous runs

  console.log("--- Fetching Matchups ---");
  const matchupsRes = await axios.get(`${BASE}/leagues/${LCK_LEAGUE_ID}/matchups`, { headers: HEADERS });
  const targetMatch = matchupsRes.data.find((m: any) => 
    m.participants.some((p: any) => p.name.toLowerCase().includes("kt rolster"))
  );

  if (!targetMatch) {
    console.log("Match not found.");
    return;
  }

  console.log(`Found Match: ${targetMatch.participants[0].name} vs ${targetMatch.participants[1].name} (ID: ${targetMatch.id})`);

  console.log("\n--- Fetching ALL Markets (Straight) ---");
  const marketsRes = await axios.get(`${BASE}/leagues/${LCK_LEAGUE_ID}/markets/straight`, { headers: HEADERS });
  
  const matchMarkets = marketsRes.data.filter((m: any) => m.matchupId === targetMatch.id);

  console.log(`Total market records found: ${matchMarkets.length}\n`);

  console.log(`${"TYPE".padEnd(12)} | ${"PERIOD".padEnd(6)} | ${"KEY".padEnd(20)} | ${"PRICE"}`);
  console.log("-".repeat(60));

  matchMarkets.forEach((mkt: any) => {
    mkt.prices.forEach((p: any) => {
      const lineStr = p.points !== undefined ? ` [${p.points}]` : "";
      const priceStr = `${p.designation}${lineStr}: ${p.price}`;
      console.log(`${mkt.type.padEnd(12)} | ${String(mkt.period).padEnd(6)} | ${mkt.key.padEnd(20)} | ${priceStr}`);
    });
  });
}

fetchAll().catch(console.error);
