import "dotenv/config";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { ArbEngine } from "./engine";
import { ArbOpportunity, OddsUpdate, EngineConfig } from "./types";
import {
  PinnacleAdapter,
  OddsApiAdapter,
  SabaAdapter,
  BaseAdapter,
} from "./adapters";

// ─── Load Config from .env ────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8080", 10);

const ENGINE_CONFIG: Partial<EngineConfig> = {
  bankroll:         parseFloat(process.env.BANKROLL    || "5000"),
  staleThresholdMs: parseInt(process.env.STALE_MS     || "5000", 10),
  delayPriorityMs:  parseInt(process.env.DELAY_MS     || "2000", 10),
  minArbPercentage: parseFloat(process.env.MIN_ARB    || "0"),
};

const parseSports = (env?: string) =>
  (env || "soccer").split(",").map((s) => s.trim()).filter(Boolean);

const parseList = (env?: string): string[] =>
  env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];

// ─── Engine ───────────────────────────────────────────────────────────────────

const engine = new ArbEngine(ENGINE_CONFIG);

// ─── Stats ────────────────────────────────────────────────────────────────────

const stats = {
  updatesReceived: 0,
  arbsDetected: 0,
  adaptersRunning: 0,
  subClients: 0,
  startedAt: Date.now(),
};

// ─── Adapters Setup ───────────────────────────────────────────────────────────

function onOdds(updates: OddsUpdate[]): void {
  stats.updatesReceived += updates.length;
  for (const update of updates) {
    const opps = engine.processUpdate(update);
    if (opps.length > 0) {
      stats.arbsDetected += opps.length;
      broadcastArbs(opps);
      logOpps(opps);
    }
  }
}

const adapters: BaseAdapter[] = [];

// ── Pinnacle ──────────────────────────────────────────────────────────────────
if (process.env.PINNACLE_ENABLED !== "false") {
  const leagueIds = parseList(process.env.PINNACLE_LEAGUE_IDS);
  adapters.push(
    new PinnacleAdapter(
      {
        sports: parseSports(process.env.PINNACLE_SPORTS),
        pollIntervalMs: parseInt(process.env.PINNACLE_POLL_MS || "3000", 10),
        leagueIds: leagueIds.length ? leagueIds : undefined,
      },
      onOdds
    )
  );
}

// ── The Odds API ──────────────────────────────────────────────────────────────
const oddsApiKey = process.env.ODDS_API_KEY;
if (oddsApiKey && oddsApiKey !== "YOUR_KEY_HERE" && process.env.ODDS_API_ENABLED !== "false") {
  const bookmakerFilter = parseList(process.env.ODDS_API_BOOKMAKERS);
  adapters.push(
    new OddsApiAdapter(
      {
        apiKey: oddsApiKey,
        sports: parseSports(process.env.ODDS_API_SPORTS),
        pollIntervalMs: parseInt(process.env.ODDS_API_POLL_MS || "15000", 10),
        regions: process.env.ODDS_API_REGIONS ?? "uk,eu",
        markets: process.env.ODDS_API_MARKETS ?? "h2h,spreads,totals",
        bookmakerFilter: bookmakerFilter.length ? bookmakerFilter : undefined,
      },
      onOdds
    )
  );
} else if (!oddsApiKey || oddsApiKey === "YOUR_KEY_HERE") {
  console.warn("[Live] ODDS_API_KEY not set — The Odds API adapter disabled");
}

// ── SABA ──────────────────────────────────────────────────────────────────────
const sabaUrl = process.env.SABA_ENDPOINT_URL;
if (process.env.SABA_ENABLED === "true" && sabaUrl) {
  adapters.push(
    new SabaAdapter(
      sabaUrl,
      process.env.SABA_AUTH_HEADER,
      {
        sports: parseSports(process.env.PINNACLE_SPORTS),
        pollIntervalMs: parseInt(process.env.SABA_POLL_MS || "2000", 10),
      },
      onOdds
    )
  );
}

stats.adaptersRunning = adapters.length;

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const subClients = new Set<WebSocket>();

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime_s: Math.round((Date.now() - stats.startedAt) / 1000),
        store_size: engine.storeSize,
        ...stats,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const path = req.url ?? "/";

  if (path === "/subscribe") {
    subClients.add(ws);
    stats.subClients = subClients.size;
    ws.send(JSON.stringify({ type: "connected", role: "subscriber" }));
    log(`Subscriber connected (total: ${subClients.size})`);

    ws.on("close", () => {
      subClients.delete(ws);
      stats.subClients = subClients.size;
    });
  } else {
    ws.send(JSON.stringify({ type: "error", message: "Use /subscribe to receive arb alerts." }));
    ws.close();
  }
});

// ─── Broadcast / Logging ──────────────────────────────────────────────────────

function broadcastArbs(opps: ArbOpportunity[]): void {
  const payload = JSON.stringify({ type: "arb", opportunities: opps });
  for (const client of subClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function logOpps(opps: ArbOpportunity[]): void {
  for (const opp of opps) {
    const prio = opp.is_high_priority ? "🔴 HIGH" : "🟢";
    log(
      `${prio} ARB ${opp.arb_percentage.toFixed(2)}% | ` +
      `${opp.match} | ${opp.market} @${opp.line} | ` +
      `${opp.sharp_bookmaker} vs ${opp.asian_bookmaker} | ` +
      `gap=${opp.latency_gap_ms}ms conf=${opp.confidence_score}`
    );
  }
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         ARB ENGINE — LIVE MODE                          ║
╠══════════════════════════════════════════════════════════╣
║  Health:     http://localhost:${PORT}/health               ║
║  Subscribe:  ws://localhost:${PORT}/subscribe              ║
╠══════════════════════════════════════════════════════════╣
║  Bankroll:   $${ENGINE_CONFIG.bankroll?.toLocaleString().padEnd(10)}                         ║
║  Stale:      ${ENGINE_CONFIG.staleThresholdMs}ms                                  ║
║  Delay:      ${ENGINE_CONFIG.delayPriorityMs}ms                                  ║
║  Min Arb:    ${ENGINE_CONFIG.minArbPercentage?.toFixed(1)}%                                ║
║  Adapters:   ${adapters.map((a) => a.bookmakerName).join(", ").padEnd(38)}║
╚══════════════════════════════════════════════════════════╝
  `);

  // Start all adapters
  for (const adapter of adapters) {
    adapter.start();
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  log("Shutting down...");
  adapters.forEach((a) => a.stop());
  httpServer.close(() => process.exit(0));
});
