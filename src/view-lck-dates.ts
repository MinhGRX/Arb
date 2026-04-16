/**
 * LCK Odds Viewer with DATE/TIME.
 * Run: npx ts-node src/view-lck-dates.ts
 */
import { PinnacleAdapter } from "./adapters/pinnacle";
import axios from "axios";

const HEADERS = {
  "X-Device-UUID": "guest",
  "Referer": "https://www.pinnacle.com/",
  "Origin": "https://www.pinnacle.com",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

async function viewWithDates() {
  const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";
  const LCK_ID = 192553;
  
  console.log("📡 Fetching LCK Matchups with Dates...");
  const matchupsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/matchups?brandId=0`, { headers: HEADERS });
  
  const matches = matchupsRes.data.filter((m: any) => 
    m.participants.length === 2 && 
    !m.participants[0].name.includes(" vs ") &&
    !["Yes", "No", "Over", "Under", "Odd", "Even"].includes(m.participants[0].name)
  );

  if (matches.length === 0) {
    console.log("❌ No matches found.");
    return;
  }

  // Display summary first
  console.log("\n📅 SCHEDULE FOUND:");
  matches.forEach((m: any) => {
    const date = new Date(m.startTime).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    console.log(`   - [${m.id}] ${date.padEnd(20)} | ${m.participants[0].name} vs ${m.participants[1].name}`);
  });

  console.log("\n💡 Ghi chú: Nếu không thấy trận bạn cần, có thể trận đó đã diễn ra hoặc ở ngày xa hơn danh sách lấy được.");
  
  // Now fetch odds for the first 3 matches
  for (const m of matches.slice(0, 3)) {
    const mId = m.id;
    const name = `${m.participants[0].name} vs ${m.participants[1].name}`;
    console.log(`\n🔥 ODDS FOR: ${name}`);
    
    try {
      const marketsRes = await axios.get(`${BASE}/leagues/${LCK_ID}/markets/straight?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
      if (marketsRes.data?.length) {
         const rows = marketsRes.data.flatMap((mkt: any) => 
            mkt.prices.map((p: any) => ({
              Period: mkt.period === 0 ? "Full" : `Map ${mkt.period}`,
              Market: mkt.type,
              Outcome: p.designation,
              Line: p.points ?? "-",
              Odds: p.price
            }))
          );
          console.table(rows);
      } else {
        console.log("   (No odds available right now)");
      }
    } catch(e) {}
  }
}

viewWithDates().catch(console.error);
