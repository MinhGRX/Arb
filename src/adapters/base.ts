import { OddsUpdate, MarketType } from "../types";

export interface AdapterConfig {
  pollIntervalMs: number;
  /** Sports to follow: "soccer" | "basketball" | "tennis" | ... */
  sports: string[];
  /** Leagues/competitions to filter, empty = all */
  leagueIds?: string[];
}

export type OddsCallback = (updates: OddsUpdate[]) => void;

/**
 * Base interface all bookmaker adapters must implement.
 */
export abstract class BaseAdapter {
  protected config: AdapterConfig;
  protected onOdds: OddsCallback;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AdapterConfig, onOdds: OddsCallback) {
    this.config = config;
    this.onOdds = onOdds;
  }

  abstract get bookmakerName(): string;
  abstract get sourceType(): "SHARP" | "ASIAN";

  /** Fetch and emit the latest odds */
  abstract fetchOdds(): Promise<void>;

  /** Start polling at the configured interval */
  start(): void {
    console.log(`[${this.bookmakerName}] Adapter starting (poll every ${this.config.pollIntervalMs}ms)`);
    this.fetchOdds().catch((e) =>
      console.error(`[${this.bookmakerName}] Initial fetch error:`, e.message)
    );
    this.pollTimer = setInterval(() => {
      this.fetchOdds().catch((e) =>
        console.error(`[${this.bookmakerName}] Poll error:`, e.message)
      );
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log(`[${this.bookmakerName}] Adapter stopped`);
    }
  }

  /** Helper: emit a batch of updates */
  protected emit(updates: OddsUpdate[]): void {
    if (updates.length > 0) {
      this.onOdds(updates);
    }
  }

  /** Normalize sport string → MarketType lookup helper */
  protected toMarket(str: string): MarketType | null {
    const s = str.toLowerCase();
    if (s.includes("1x2") || s.includes("moneyline") || s.includes("match_winner")) return "1x2";
    if (s.includes("over") || s.includes("total") || s.includes("ou")) return "over_under";
    if (s.includes("handicap") || s.includes("spread") || s.includes("asian_handicap")) return "handicap";
    return null;
  }
}
