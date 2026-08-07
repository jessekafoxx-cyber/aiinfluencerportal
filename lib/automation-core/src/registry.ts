import type { WorkflowDefinition } from "./types";

export class WorkflowRegistry {
  private readonly map = new Map<string, WorkflowDefinition>();

  register(def: WorkflowDefinition): this {
    if (this.map.has(def.slug)) {
      throw new Error(`Workflow '${def.slug}' is already registered`);
    }
    this.map.set(def.slug, def);
    return this;
  }

  /**
   * Insert or replace a workflow definition by slug. Used for ephemeral,
   * DB-materialized workflows (e.g. user-created rows from the API) where
   * the persisted row may have been edited via upsert and the in-memory
   * definition needs to be refreshed without a process restart.
   */
  set(def: WorkflowDefinition): this {
    this.map.set(def.slug, def);
    return this;
  }

  get(slug: string): WorkflowDefinition | undefined {
    return this.map.get(slug);
  }

  require(slug: string): WorkflowDefinition {
    const def = this.map.get(slug);
    if (!def) throw new Error(`Workflow '${slug}' is not registered`);
    return def;
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.map.values());
  }
}
