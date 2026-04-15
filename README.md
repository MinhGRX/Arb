# ⚡ Arb — Real-Time Sports Arbitrage Detection Engine

A high-performance, in-memory arbitrage detection engine that exploits odds delay between **Sharp** (Pinnacle) and **Asian** bookmakers (SABA, CMD, BTi, 8xbet, TF Gaming).

---

## How It Works

```
WebSocket Feed ──► ArbEngine.processUpdate() ──► OddsStore (in-memory)
                                                       │
                                              ┌────────┴────────┐
                                              │  Detect Arbs     │
                                              │  SHARP vs ASIAN  │
                                              └────────┬────────┘
                                                       │
                                              ArbOpportunity[]
                                              (sorted by profit)
```

### The Edge

Asian bookmakers (SABA, CMD, BTi, etc.) often lag behind Pinnacle by **milliseconds to seconds**. When Pinnacle moves first, there's a brief window where the old Asian odds create a guaranteed profit.

---

## Features

| Feature | Detail |
|---|---|
| **2-way arb** | Over/Under, Handicap |
| **3-way arb** | 1x2 (Home/Draw/Away) |
| **Delay detection** | SHARP moved < 2s ago + ASIAN lagging = 🔴 HIGH PRIORITY |
| **Confidence scoring** | 0–100 based on latency gap, arb %, and priority |
| **Stake calculator** | Equal-profit formula across all outcomes |
| **Deduplication** | Identical odds from same bookmaker are ignored |
| **Stale eviction** | Odds older than 5s auto-discarded on read |
| **O(1) lookups** | Dual-indexed in-memory store |

---

## Quick Start

```bash
# Install
npm install

# 1. Verify Pinnacle live data works (no auth needed)
npm run test:pinnacle

# 2. End-to-end pipeline test (Pinnacle → engine → output)
npm run test:live

# 3. Run simulation with fake data (4 scenarios)
npm run dev

# 4. Start live mode (real odds from configured adapters)
cp .env.example .env     # then fill in ODDS_API_KEY
npm run live

# Build & run compiled
npm run build && npm start
```

---

## Live Data Sources

### ✅ Pinnacle (SHARP) — No API key required

The Pinnacle adapter polls their public guest API at `guest.api.arcadia.pinnacle.com` — no account or auth needed.

```
GET /0.1/sports/{sportId}/leagues      → live league list
GET /0.1/leagues/{id}/matchups         → team names per match
GET /0.1/leagues/{id}/markets/straight → straight-bet prices (American odds, auto-converted to decimal)
```

**Verified live:** `1,617 updates / ~4s` — 195 soccer + 64 basketball matches.

### ✅ The Odds API — Free tier (500 req/month)

Aggregates dozens of bookmakers including sharp/Asian-adjacent ones (Pinnacle, LowVig, BetOnline, BetCris).

1. Get a free API key at **https://the-odds-api.com**
2. Set `ODDS_API_KEY=your_key` in `.env`
3. Reload `npm run live`

### ⚙️ SABA / CMD / BTi / 8xbet / TF Gaming

These are operator B2B platforms. Their odds are available via:
- **Member portal JSON APIs** — set `SABA_ENABLED=true` + `SABA_ENDPOINT_URL` + `SABA_AUTH_HEADER` in `.env`
- Extend `ScrapeAdapter` in `src/adapters/scraper.ts` for each book's specific response schema



---

## WebSocket API

The server exposes two WebSocket endpoints and one HTTP health check.

### `GET /health`

Returns server stats, store size, and uptime.

### `GET /history`

Returns the last 100 detected arbitrage opportunities from the persistent log.

---

### `ws://host:8080/feed` — Odds Producer

Send a single update or a batch array:

```json
{
  "match_id": "Arsenal vs Chelsea",
  "sport": "Football",
  "market": "handicap",
  "line": -0.5,
  "bookmaker": "Pinnacle",
  "source_type": "SHARP",
  "outcome": "home",
  "odds": 2.15,
  "timestamp": 1713168000000
}
```

Or batch:

```json
[
  { ...update1 },
  { ...update2 }
]
```

---

### `ws://host:8080/subscribe` — Arb Subscriber

Receives push notifications whenever an arb is detected:

```json
{
  "type": "arb",
  "opportunities": [
    {
      "match": "Arsenal vs Chelsea",
      "market": "handicap",
      "line": -0.5,
      "sharp_bookmaker": "Pinnacle",
      "asian_bookmaker": "SABA",
      "sharp_odds": { "home": 2.15 },
      "asian_odds": { "away": 1.97 },
      "arb_percentage": 2.73,
      "latency_gap_ms": 3000,
      "recommended_stakes": { "home": 2390.78, "away": 2609.22 },
      "confidence_score": 82,
      "is_high_priority": true,
      "detected_at": 1713168005000
    }
  ]
}
```

---

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `BANKROLL` | `5000` | Stake calculation bankroll |
| `STALE_MS` | `5000` | Evict odds older than this (ms) |
| `DELAY_MS` | `2000` | SHARP move window for high-priority (ms) |
| `MIN_ARB` | `0` | Minimum arb % to emit (filter noise) |

```bash
PORT=9000 BANKROLL=10000 MIN_ARB=1.5 npm run server
```

---

## Project Structure

```
src/
├── types.ts    # Interfaces, config, bookmaker constants
├── store.ts    # In-memory odds store (composite-key indexing)
├── engine.ts   # Core arb detection engine
└── index.ts    # Simulation / entry point
```

---

## Input Format

```ts
{
  match_id: "Man City vs Liverpool",
  sport: "Football",
  market: "over_under",        // "1x2" | "over_under" | "handicap"
  line: 2.5,
  bookmaker: "Pinnacle",
  source_type: "SHARP",        // "SHARP" | "ASIAN"
  outcome: "over",             // home | away | draw | over | under
  odds: 2.15,
  timestamp: 1713168000000     // epoch ms
}
```

## Output Format

```ts
{
  match: "Man City vs Liverpool",
  market: "over_under",
  line: 2.5,
  sharp_bookmaker: "Pinnacle",
  asian_bookmaker: "SABA",
  sharp_odds: { over: 2.15 },
  asian_odds: { under: 1.95 },
  arb_percentage: 2.206,       // positive = profitable
  latency_gap_ms: 3000,
  recommended_stakes: { over: 2378.05, under: 2621.95 },
  confidence_score: 78,        // 0–100
  is_high_priority: true
}
```

---

## Arbitrage Formula

**2-way:**
```
(1/odds_sharp) + (1/odds_asian) < 1  →  arb exists
```

**3-way (1x2):**
```
(1/home) + (1/draw) + (1/away) < 1  →  arb exists
```

**Stakes (equal-profit):**
```
stake_i = (bankroll / odds_i) / Σ(1/odds_j)
```

---

## Configuration

```ts
const engine = new ArbEngine({
  bankroll: 5000,            // total capital
  staleThresholdMs: 5000,    // discard odds older than 5s
  delayPriorityMs: 2000,     // SHARP move within 2s = high priority
  minArbPercentage: 0,       // filter small arbs
  maxOpportunities: 50,      // cap output per tick
});
```

---

## Bookmakers

| Type | Books |
|---|---|
| **SHARP** | Pinnacle |
| **ASIAN** | SABA, CMD, BTi, 8xbet, TF Gaming |

---

## License

ISC
