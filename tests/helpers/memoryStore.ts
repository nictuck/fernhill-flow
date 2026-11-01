// In-memory Store with the same conditional-write semantics as Netlify
// Blobs: `onlyIfNew` fails when the key exists, `onlyIfMatch` fails when the
// etag differs. The check-and-set is atomic (after the optional latency), so
// two concurrent takers resolve the way Blobs would.

import type { SetOptions, Store } from "../../netlify/lib/store.ts";

export class MemoryStore implements Store {
  readonly data = new Map<string, { value: string; etag: string }>();
  /** every operation, for assertions on what a path touched */
  readonly ops: string[] = [];
  /** optional latency before each operation, to widen races in tests */
  latencyMs = 0;
  private seq = 0;

  private async wait(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async getJSON<T>(key: string): Promise<T | null> {
    await this.wait();
    this.ops.push(`get ${key}`);
    const entry = this.data.get(key);
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async getWithEtag<T>(key: string): Promise<{ value: T; etag: string } | null> {
    await this.wait();
    this.ops.push(`get+etag ${key}`);
    const entry = this.data.get(key);
    return entry ? { value: JSON.parse(entry.value) as T, etag: entry.etag } : null;
  }

  async setJSON(key: string, value: unknown, opts: SetOptions = {}): Promise<{ modified: boolean }> {
    await this.wait();
    const existing = this.data.get(key);
    if (opts.onlyIfNew && existing) {
      this.ops.push(`set ${key} (onlyIfNew: lost)`);
      return { modified: false };
    }
    if (opts.onlyIfMatch !== undefined && (!existing || existing.etag !== opts.onlyIfMatch)) {
      this.ops.push(`set ${key} (onlyIfMatch: lost)`);
      return { modified: false };
    }
    this.seq += 1;
    this.data.set(key, { value: JSON.stringify(value), etag: `"e${this.seq}"` });
    this.ops.push(`set ${key}`);
    return { modified: true };
  }

  async delete(key: string): Promise<void> {
    await this.wait();
    this.ops.push(`delete ${key}`);
    this.data.delete(key);
  }

  /** Seed a key directly (tests only). */
  seed(key: string, value: unknown): void {
    this.seq += 1;
    this.data.set(key, { value: JSON.stringify(value), etag: `"e${this.seq}"` });
  }
}
