import axios from "axios";

/**
 * Script to fetch ALL possible odds (Straight + Specials) for a specific match on Pinnacle.
 */

const HEADERS = {
  "X-Device-UUID": "guest",
  "Referer": "https://www.pinnacle.com/",
  "Origin": "https://www.pinnacle.com",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "application/json",
};
const BASE = "https://guest.api.arcadia.pinnacle.com/0.1";

async function fetchEverything(leagueId: number, matchSearch: string) {
  console.log(`📡 Đang tìm kiếm trận đấu có tên "${matchSearch}" trong League [${leagueId}]...`);

  // 1. Tìm Matchup
  const matchupsRes = await axios.get(`${BASE}/leagues/${leagueId}/matchups`, { headers: HEADERS });
  
  // Lọc lấy trận chính (thường là trận có participants.length === 2 và không phải là các kèo phụ)
  const matches = matchupsRes.data.filter((m: any) => 
    JSON.stringify(m.participants).toLowerCase().includes(matchSearch.toLowerCase())
  );

  if (matches.length === 0) {
    console.log("❌ Không tìm thấy trận đấu nào khớp với từ khóa.");
    return;
  }

  // Lấy trận đầu tiên làm đại diện hoặc liệt kê tất cả
  for (const match of matches) {
    const mId = match.id;
    const team1 = match.participants[0]?.name || "Team 1";
    const team2 = match.participants[1]?.name || "Team 2";
    console.log(`\n🔥 HIỆN ĐANG XEM TRẬN: ${team1} vs ${team2} [ID: ${mId}]`);
    console.log(`⏰ Bắt đầu: ${new Date(match.startTime).toLocaleString("vi-VN")}`);

    // 2. Lấy Kèo Chính (Straight Markets) - Bao gồm cả Alternate
    console.log("   - Đang fetch kèo chính (Straight)...");
    const straightRes = await axios.get(`${BASE}/markets/straight?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
    
    // 3. Lấy Kèo Đặc Biệt (Special Markets)
    console.log("   - Đang fetch kèo đặc biệt (Specials)...");
    let specials: any[] = [];
    try {
      const specRes = await axios.get(`${BASE}/markets/special?brandId=0&matchupIds=${mId}`, { headers: HEADERS });
      specials = specRes.data || [];
    } catch (e) {
      // Ignored
    }

    // --- HIỂN THỊ KẾT QUẢ KÈO CHÍNH ---
    if (straightRes.data && straightRes.data.length > 0) {
      console.log("\n📊 [KÈO CHÍNH & PHỤ]");
      const rows = straightRes.data.flatMap((mkt: any) => 
        mkt.prices.map((p: any) => ({
          Map: mkt.period === 0 ? "Full" : `Map ${mkt.period}`,
          Type: mkt.type,
          Market: mkt.key,
          Outcome: p.designation,
          Line: p.points ?? "-",
          Price: p.price,
          IsAlt: mkt.isAlternate ? "YES" : "NO"
        }))
      );
      console.table(rows);
    } else {
      console.log("   (Không có kèo chính tại thời điểm này)");
    }

    // --- HIỂN THỊ KẾT QUẢ KÈO ĐẶC BIỆT ---
    if (specials.length > 0) {
      console.log("\n🎯 [KÈO ĐẶC BIỆT / PROPS]");
      specials.forEach((s: any) => {
        const periodStr = s.period === 0 ? "Toàn trận" : `Map ${s.period}`;
        console.log(`> ${s.name} (${periodStr})`);
        s.prices.forEach((p: any) => {
            const lineStr = p.points !== undefined ? ` [${p.points}]` : "";
            console.log(`  - ${p.designation}${lineStr}: ${p.price}`);
        });
      });
    } else {
      console.log("   (Không có kèo đặc biệt tại thời điểm này)");
    }
    console.log("\n" + "=".repeat(50));
  }
}

// Mặc định tìm LCK (192553) nếu không truyền ID
// Sử dụng: npx ts-node src/get-all-pinnacle-odds.ts [LeagueID] [TeamName]
// Ví dụ: npx ts-node src/get-all-pinnacle-odds.ts 192553 T1
const LCK_ID = 192553;
const arg1 = process.argv[2];
const arg2 = process.argv[3];

let leagueId = LCK_ID;
let searchTerm = "T1";

if (arg1 && !isNaN(Number(arg1))) {
  leagueId = Number(arg1);
  searchTerm = arg2 || "";
} else if (arg1) {
  searchTerm = arg1;
}

fetchEverything(leagueId, searchTerm).catch(err => {
  console.error("❌ Lỗi:", err.message);
});
