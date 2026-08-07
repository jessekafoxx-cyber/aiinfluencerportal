import type { ProviderAdapter } from "./types";

export class ProviderRegistry {
  private readonly map = new Map<string, ProviderAdapter<unknown, unknown>>();

  register<TInput, TOutput>(adapter: ProviderAdapter<TInput, TOutput>): this {
    if (this.map.has(adapter.slug)) {
      throw new Error(`Provider adapter '${adapter.slug}' is already registered`);
    }
    this.map.set(
      adapter.slug,
      adapter as unknown as ProviderAdapter<unknown, unknown>,
    );
    return this;
  }

  get<TInput = unknown, TOutput = unknown>(
    slug: string,
  ): ProviderAdapter<TInput, TOutput> | undefined {
    const found = this.map.get(slug);
    if (!found) return undefined;
    return found as unknown as ProviderAdapter<TInput, TOutput>;
  }

  require<TInput = unknown, TOutput = unknown>(
    slug: string,
  ): ProviderAdapter<TInput, TOutput> {
    const adapter = this.get<TInput, TOutput>(slug);
    if (!adapter) {
      throw new Error(`Provider adapter '${slug}' is not registered`);
    }
    return adapter;
  }

  has(slug: string): boolean {
    return this.map.has(slug);
  }

  list(): ReadonlyArray<ProviderAdapter<unknown, unknown>> {
    return Array.from(this.map.values());
  }
}
