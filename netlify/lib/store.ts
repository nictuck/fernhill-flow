// Snapshot storage (spec: Shape). One Netlify Blobs store, keys prefixed by
// the deploy context so staging never writes production's board. Behind an
// interface so tests run on an in-memory implementation with the same
// conditional-write semantics (plan: riskiest step).

import { getStore } from "@netlify/blobs";
import type { Store as NetlifyBlobStore } from "@netlify/blobs";

export interface SetOptions {
  /** write only when the key does not exist */
  onlyIfNew?: boolean;
  /** write only when the key exists with this etag */
  onlyIfMatch?: string;
}

export interface Store {
  getJSON<T>(key: string): Promise<T | null>;
  getWithEtag<T>(key: string): Promise<{ value: T; etag: string } | null>;
  setJSON(key: string, value: unknown, opts?: SetOptions): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}

export const KEYS = {
  latest: "latest",
  previous: "previous",
  lock: "lock",
  etags: "etags",
  lastError: "last-error",
} as const;

export const STORE_NAME = "flow";

/** Deploy contexts Netlify uses; anything else is refused rather than guessed. */
const PREFIX_RE = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * The key prefix: the request's deploy context, else `CONTEXT` from the
 * build environment. Never a shared default — a missing context is an
 * error the handler reports (500), not a key everyone writes to.
 */
export function resolvePrefix(
  context: { deploy?: { context?: string } } | undefined,
  env: { CONTEXT?: string | undefined } = process.env,
): string | undefined {
  const candidate = context?.deploy?.context ?? env.CONTEXT;
  if (typeof candidate !== "string" || !PREFIX_RE.test(candidate)) return undefined;
  return candidate;
}

export class BlobsStore implements Store {
  private readonly prefix: string;
  private blobs: NetlifyBlobStore | undefined;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private store(): NetlifyBlobStore {
    this.blobs ??= getStore({ name: STORE_NAME, consistency: "strong" });
    return this.blobs;
  }

  private key(key: string): string {
    return `${this.prefix}/${key}`;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const value: unknown = await this.store().get(this.key(key), { type: "json" });
    return value === null || value === undefined ? null : (value as T);
  }

  async getWithEtag<T>(key: string): Promise<{ value: T; etag: string } | null> {
    const result = await this.store().getWithMetadata(this.key(key), { type: "json" });
    if (!result || result.data === null || result.data === undefined || !result.etag) return null;
    return { value: result.data as T, etag: result.etag };
  }

  async setJSON(key: string, value: unknown, opts: SetOptions = {}): Promise<{ modified: boolean }> {
    const k = this.key(key);
    let result: { modified: boolean };
    if (opts.onlyIfMatch !== undefined) {
      result = await this.store().setJSON(k, value, { onlyIfMatch: opts.onlyIfMatch });
    } else if (opts.onlyIfNew) {
      result = await this.store().setJSON(k, value, { onlyIfNew: true });
    } else {
      result = await this.store().setJSON(k, value);
    }
    return { modified: result.modified };
  }

  async delete(key: string): Promise<void> {
    await this.store().delete(this.key(key));
  }
}

export function makeStore(prefix: string): Store {
  return new BlobsStore(prefix);
}
