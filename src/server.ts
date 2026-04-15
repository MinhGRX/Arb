import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { ArbEngine } from "./engine";
import { OddsUpdate, ArbOpportunity, EngineConfig, DEFAULT_CONFIG } from "./types";

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8080", 10);
const ENGINE_CONFIG: Partial<EngineConfig> = {
  bankroll: parseFloat(process.env.BANKROLL || "5000"),
  staleThresholdMs: parseInt(process.env.STALE_MS || "5000", 10),
  delayPriorityMs: parseInt(process.env.DELAY_MS || "2000", 10),
  minArbPercentage: parseFloat(process.env.MIN_ARB || "0"),
};

// ─── Engine ──────────────────────────────────────────────────────────────────

const engine = new ArbEngine(ENGINE_CONFIG);

// ─── Stats ───────────────────────────────────────────────────────────────────

let stats = {
  updatesReceived: 0,
  arbsDetected: 0,
  feedClients: 0,     // clients sending odds
  subClients: 0,      // clients subscribing to arbs
  startedAt: Date.now(),
};

// ─── HTTP Server (health check) ──────────────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      uptime_s: Math.round((Date.now() - stats.startedAt) / 1000),
      store_size: engine.storeSize,
      ...stats,
    }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

// Track client roles
const feedClients = new Set<WebSocket>();   // send odds updates
const subClients = new Set<WebSocket>();    // receive arb alerts

wss.on("connection", (ws, req) => {
  const path = req.url || "/";
  log(`Client connected: ${path}`);

  if (path === "/feed") {
    // ── Odds Feed Producer ───────────────────────────────────────────────
    feedClients.add(ws);
    stats.feedClients = feedClients.size;
    ws.send(JSON.stringify({ type: "connected", role: "feed" }));

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // Support single update or batch
        const updates: OddsUpdate[] = Array.isArray(data) ? data : [data];

        for (const update of updates) {
          stats.updatesReceived++;
          const opps = engine.processUpdate(update);

          if (opps.length > 0) {
            stats.arbsDetected += opps.length;
            broadcastArbs(opps);
          }
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      feedClients.delete(ws);
      stats.feedClients = feedClients.size;
      log("Feed client disconnected");
    });

  } else if (path === "/subscribe") {
    // ── Arb Subscriber ───────────────────────────────────────────────────
    subClients.add(ws);
    stats.subClients = subClients.size;
    ws.send(JSON.stringify({ type: "connected", role: "subscriber" }));

    ws.on("close", () => {
      subClients.delete(ws);
      stats.subClients = subClients.size;
      log("Subscriber disconnected");
    });

  } else {
    ws.send(JSON.stringify({
      type: "error",
      message: "Unknown path. Use /feed (send odds) or /subscribe (receive arbs).",
    }));
    ws.close();
  }
});

// ─── Broadcast ───────────────────────────────────────────────────────────────

function broadcastArbs(opps: ArbOpportunity[]): void {
  const payload = JSON.stringify({ type: "arb", opportunities: opps });

  for (const client of subClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }

  // Log to server console
  for (const opp of opps) {
    const prio = opp.is_high_priority ? "🔴 HIGH" : "🟢";
    log(`${prio} ARB ${opp.arb_percentage.toFixed(2)}% | ${opp.match} | ${opp.market} ${opp.line} | ${opp.sharp_bookmaker} vs ${opp.asian_bookmaker} | conf=${opp.confidence_score}`);
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          ARB ENGINE — WebSocket Server                  ║
╠══════════════════════════════════════════════════════════╣
║  Health:     http://localhost:${PORT}/health               ║
║  Feed:       ws://localhost:${PORT}/feed                   ║
║  Subscribe:  ws://localhost:${PORT}/subscribe              ║
╠══════════════════════════════════════════════════════════╣
║  Bankroll:   $${ENGINE_CONFIG.bankroll?.toLocaleString().padEnd(10)}                         ║
║  Stale:      ${ENGINE_CONFIG.staleThresholdMs}ms                                  ║
║  Delay:      ${ENGINE_CONFIG.delayPriorityMs}ms                                  ║
╚══════════════════════════════════════════════════════════╝
  `);
});
