import { OddsUpdate } from "./types";

/**
 * High-performance in-memory odds store with O(1) lookups.
 *
 * Key structure:  normalizedMatchId::market::line::bookmaker::outcome
 *
 * Provides:
 * - Deduplication (same bookmaker + same odds = skip)
 * - Stale eviction on read
 * - Fast grouped queries by match/market/line
 */
export class OddsStore {
  /** Primary store: composite key → latest OddsUpdate */
  private store = new Map<string, OddsUpdate>();

  /** Secondary index: groupKey → Set<compositeKey> for fast range queries */
  private groupIndex = new Map<string, Set<string>>();

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Upsert an odds update.
   * @returns true if the store was actually mutated (new or changed odds).
   */
  upsert(update: OddsUpdate): boolean {
    const key = this.compositeKey(update);
    const existing = this.store.get(key);

    // Deduplicate: identical odds from same bookmaker → no-op
    if (existing && existing.odds === update.odds && existing.timestamp <= update.timestamp) {
      return false;
    }

    this.store.set(key, update);

    // Maintain group index
    const gk = this.groupKey(update);
    let group = this.groupIndex.get(gk);
    if (!group) {
      group = new Set();
      this.groupIndex.set(gk, group);
    }
    group.add(key);

    return true;
  }

  /**
   * Retrieve all non-stale odds for a given match + market + line + period.
   */
  getGroup(matchId: string, market: string, line: number, period: number, staleMs: number): OddsUpdate[] {
    const now = Date.now();
    const gk = `${this.normalize(matchId)}::${market}::${line}::${period}`;
    const keys = this.groupIndex.get(gk);
    if (!keys) return [];

    const results: OddsUpdate[] = [];
    const staleKeys: string[] = [];

    for (const k of keys) {
      const entry = this.store.get(k);
      if (!entry) {
        staleKeys.push(k);
        continue;
      }
      if (now - entry.timestamp > staleMs) {
        staleKeys.push(k);
        this.store.delete(k);
        continue;
      }
      results.push(entry);
    }

    // Lazy cleanup of stale keys from the index
    for (const sk of staleKeys) keys.delete(sk);

    return results;
  }

  /** Total entries currently held */
  get size(): number {
    return this.store.size;
  }

  /** Flush everything (useful for tests) */
  clear(): void {
    this.store.clear();
    this.groupIndex.clear();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private compositeKey(u: OddsUpdate): string {
    return `${this.normalize(u.match_id)}::${u.market}::${u.line}::${u.period || 0}::${u.bookmaker}::${u.outcome}`;
  }

  private groupKey(u: OddsUpdate): string {
    return `${this.normalize(u.match_id)}::${u.market}::${u.line}::${u.period || 0}`;
  }

  private normalize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
}
