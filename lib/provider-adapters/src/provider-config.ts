import { and, eq } from "drizzle-orm";
import type { db as DB } from "@workspace/db";
import { providerConfigsTable } from "@workspace/db";
import { ProviderConfigurationError } from "./types";

type Db = typeof DB;

/**
 * Reads a `provider_configs` row by (providerSlug, key) and returns its value
 * coerced to T. Returns `undefined` when the row is absent.
 *
 * The cache is process-local with a short TTL so admins can change values
 * without redeploying.
 */
export interface ProviderConfigStoreOptions {
  db: Db;
  cacheTtlMs?: number;
}

const DEFAULT_TTL_MS = 30_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export class ProviderConfigStore {
  private readonly db: Db;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: ProviderConfigStoreOptions) {
    this.db = opts.db;
    this.ttlMs = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  }

  private cacheKey(providerSlug: string, key: string): string {
    return `${providerSlug}::${key}`;
  }

  async get<T = unknown>(
    providerSlug: string,
    key: string,
  ): Promise<T | undefined> {
    const ck = this.cacheKey(providerSlug, key);
    const now = Date.now();
    const cached = this.cache.get(ck);
    if (cached && cached.expiresAt > now) {
      return cached.value as T | undefined;
    }
    const rows = await this.db
      .select({ value: providerConfigsTable.value })
      .from(providerConfigsTable)
      .where(
        and(
          eq(providerConfigsTable.providerSlug, providerSlug),
          eq(providerConfigsTable.key, key),
        ),
      )
      .limit(1);
    const value = rows[0]?.value as T | undefined;
    this.cache.set(ck, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  async require<T = unknown>(providerSlug: string, key: string): Promise<T> {
    const value = await this.get<T>(providerSlug, key);
    if (value == null) {
      throw new ProviderConfigurationError(
        providerSlug,
        `Missing required provider_configs row for key '${key}'. ` +
          `Insert one via: INSERT INTO provider_configs (provider_slug, key, value) VALUES ('${providerSlug}', '${key}', '<json>'::jsonb).`,
      );
    }
    return value;
  }

  invalidate(providerSlug?: string, key?: string): void {
    if (!providerSlug) {
      this.cache.clear();
      return;
    }
    if (!key) {
      for (const k of Array.from(this.cache.keys())) {
        if (k.startsWith(`${providerSlug}::`)) this.cache.delete(k);
      }
      return;
    }
    this.cache.delete(this.cacheKey(providerSlug, key));
  }
}
