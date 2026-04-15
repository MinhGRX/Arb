import fs from "fs/promises";
import path from "path";
import { ArbOpportunity } from "./types";

/**
 * Simple file-based persistence for detected arbitrage opportunities.
 * In a production system, this would be a Time-Series Database (InfluxDB/Prometheus) 
 * or a standard SQL DB with proper indexing.
 */
export class OpportunityLogger {
  private logPath: string;

  constructor(dir: string = "logs") {
    this.logPath = path.join(process.cwd(), dir, "arbs_detected.jsonl");
    this.ensureDir(dir);
  }

  private async ensureDir(dir: string) {
    try {
      await fs.mkdir(path.join(process.cwd(), dir), { recursive: true });
    } catch (err) {}
  }

  async log(opps: ArbOpportunity[]) {
    if (opps.length === 0) return;
    
    const timestamp = new Date().toISOString();
    const entries = opps.map(opp => JSON.stringify({ ...opp, logged_at: timestamp })).join("\n") + "\n";
    
    try {
      await fs.appendFile(this.logPath, entries);
    } catch (err) {
      console.error("[Logger] Failed to write to log file:", err);
    }
  }

  async getRecent(limit: number = 50): Promise<ArbOpportunity[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines
        .slice(-limit)
        .map(line => JSON.parse(line))
        .reverse();
    } catch (err) {
      return [];
    }
  }
}
