import { sql } from "drizzle-orm";
import { db, providerWebhookEventsTable, automationJobsTable } from "@workspace/db";

/**
 * Drizzle's transaction callback hands back a transaction object whose API
 * surface is identical to the root `db` for our needs (`.update`, `.execute`,
 * `.transaction` for SAVEPOINTs). We type our internal helper against that
 * callback param so the same routine works whether it's invoked at the root
 * or already inside a parent transaction.
 */
type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
import { logger } from "../lib/logger";
import type { AutomationRuntime } from "./runner";

/**
 * Polls `provider_webhook_events` for ingested-but-unprocessed rows and
 * applies them to in-flight automation jobs via
 * `runtime.runner.applyWebhookUpdate`. The HTTP webhook handler only
 * verifies + persists; this loop owns adapter normalization and matching so
 * the request edge can return 202 in milliseconds and provider redelivery is
 * never required for slow downstream work.
 *
 * Concurrency is safe across multiple processes because each iteration claims
 * exactly one row using `SELECT ... FOR UPDATE SKIP LOCKED`. Permanent errors
 * are recorded in `process_error` and the row is marked processed so it
 * doesn't loop forever; transient errors leave the row available for retry.
 */
export interface WebhookProcessorOptions {
  runtime: AutomationRuntime;
  /** Idle poll interval when nothing pending (default 2000ms). */
  idleIntervalMs?: number;
}

export class WebhookProcessor {
  private readonly runtime: AutomationRuntime;
  private readonly idleIntervalMs: number;
  private readonly abort = new AbortController();
  private loop: Promise<void> | null = null;

  constructor(opts: WebhookProcessorOptions) {
    this.runtime = opts.runtime;
    this.idleIntervalMs = opts.idleIntervalMs ?? 2000;
  }

  start(): void {
    if (this.loop) return;
    this.loop = this.runLoop();
    logger.info("Webhook processor started");
  }

  async stop(): Promise<void> {
    this.abort.abort();
    if (this.loop) await this.loop.catch(() => undefined);
    this.loop = null;
    logger.info("Webhook processor stopped");
  }

  /**
   * Drains all pending events (used by tests so they don't have to wait for
   * the polling loop). Returns the count of events processed.
   */
  async drain(): Promise<number> {
    let processed = 0;
    // Bound the loop to avoid runaways in tests.
    for (let i = 0; i < 100; i++) {
      const did = await this.processOne();
      if (!did) return processed;
      processed += 1;
    }
    return processed;
  }

  private async runLoop(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const did = await this.processOne();
        if (!did) await this.sleep(this.idleIntervalMs);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "Webhook processor iteration error",
        );
        await this.sleep(this.idleIntervalMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }

  /**
   * Claim and process exactly one pending webhook event. Returns true if a
   * row was claimed (regardless of processing outcome), false when no work
   * was available.
   */
  private async processOne(): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const claimed = await tx.execute(
        sql`SELECT id, provider_slug, payload
            FROM provider_webhook_events
            WHERE processed_at IS NULL
            ORDER BY received_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1`,
      );
      const rows = (claimed.rows ?? []) as Array<{
        id: number;
        provider_slug: string;
        payload: Record<string, unknown> | null;
      }>;
      const row = rows[0];
      if (!row) return false;

      try {
        await this.processEvent(tx, row);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg, eventId: row.id, slug: row.provider_slug }, "processOne threw");
        await tx
          .update(providerWebhookEventsTable)
          .set({ processedAt: new Date(), processError: msg })
          .where(sql`id = ${row.id}`);
      }
      return true;
    });
  }

  private async processEvent(
    tx: DbOrTx,
    row: { id: number; provider_slug: string; payload: Record<string, unknown> | null },
  ): Promise<void> {
    const slug = row.provider_slug;
    const adapter = this.runtime.adapters.get(slug);
    if (!adapter) {
      await tx
        .update(providerWebhookEventsTable)
        .set({ processedAt: new Date(), processError: "unknown adapter" })
        .where(sql`id = ${row.id}`);
      return;
    }
    if (!adapter.handleWebhook) {
      await tx
        .update(providerWebhookEventsTable)
        .set({ processedAt: new Date(), processError: "adapter has no handleWebhook" })
        .where(sql`id = ${row.id}`);
      return;
    }

    let normalized: Awaited<ReturnType<NonNullable<typeof adapter.handleWebhook>>>;
    try {
      normalized = await adapter.handleWebhook(row.payload ?? {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tx
        .update(providerWebhookEventsTable)
        .set({ processedAt: new Date(), processError: `handleWebhook: ${msg}` })
        .where(sql`id = ${row.id}`);
      return;
    }

    if (!normalized) {
      await tx
        .update(providerWebhookEventsTable)
        .set({ processedAt: new Date(), eventType: "ignored" })
        .where(sql`id = ${row.id}`);
      return;
    }

    // Persistence-level semantic dedupe: try to claim (provider_slug,
    // external_ref). The partial unique index
    // `provider_external_unique` raises 23505 if any prior event for the
    // same (slug, externalRef) already wrote that pair. When that happens
    // we mark the row deduped and skip applyWebhookUpdate, so a provider
    // re-delivering the same logical event with a non-identical envelope
    // (e.g. fresh timestamp that bypasses dedupe_key) cannot double-apply.
    //
    // Postgres aborts the *whole* transaction on a constraint violation, so
    // the UPDATE that may raise 23505 has to be wrapped in a SAVEPOINT.
    // Drizzle's nested `tx.transaction(...)` opens a SAVEPOINT we can roll
    // back without losing the outer transaction.
    const tryClaimExternalRef = async (
      ref: string,
    ): Promise<"claimed" | "duplicate"> => {
      try {
        await tx.transaction(async (sp) => {
          await sp
            .update(providerWebhookEventsTable)
            .set({ externalRef: ref })
            .where(sql`id = ${row.id}`);
        });
        return "claimed";
      } catch (err) {
        // Drizzle wraps the underlying pg error; the unique-violation `code`
        // can live on the wrapper, on `.cause`, or on a deeper original.
        const e = err as
          | { code?: string; cause?: { code?: string; cause?: { code?: string } } }
          | null;
        const code = e?.code ?? e?.cause?.code ?? e?.cause?.cause?.code;
        if (code === "23505") return "duplicate";
        throw err;
      }
    };

    if (normalized.status === "pending") {
      if (normalized.externalRef) {
        const claim = await tryClaimExternalRef(normalized.externalRef);
        if (claim === "duplicate") {
          await tx
            .update(providerWebhookEventsTable)
            .set({
              processedAt: new Date(),
              eventType: "deduped",
              processError: "duplicate externalRef",
            })
            .where(sql`id = ${row.id}`);
          return;
        }
      }
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: normalized.status,
        })
        .where(sql`id = ${row.id}`);
      return;
    }

    const externalRef = normalized.externalRef;
    if (!externalRef) {
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: normalized.status,
          processError: "missing externalRef in normalized webhook update",
        })
        .where(sql`id = ${row.id}`);
      return;
    }

    const claim = await tryClaimExternalRef(externalRef);
    if (claim === "duplicate") {
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: "deduped",
          processError: "duplicate externalRef",
        })
        .where(sql`id = ${row.id}`);
      logger.info(
        { eventId: row.id, slug, externalRef },
        "Webhook event deduped by externalRef at processor",
      );
      return;
    }

    const matches = await tx
      .select({ id: automationJobsTable.id })
      .from(automationJobsTable)
      .where(
        sql`${automationJobsTable.payload}->'state'->'pending'->>'externalRef' = ${externalRef}
            AND ${automationJobsTable.payload}->'state'->'pending'->>'providerSlug' = ${slug}
            AND ${automationJobsTable.status} IN ('queued','running','retrying')`,
      )
      .limit(1);
    const job = matches[0];
    if (!job) {
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: normalized.status,
          externalRef,
          processError: `no pending job found for externalRef=${externalRef}`,
        })
        .where(sql`id = ${row.id}`);
      return;
    }

    // applyWebhookUpdate manages its own DB writes (job state + reservation).
    // It is safe to call from inside our transaction; if it fails we record
    // the error on the event row.
    try {
      const outcome = await this.runtime.runner.applyWebhookUpdate(job.id, {
        providerSlug: slug,
        externalRef,
        status: normalized.status === "completed" ? "completed" : "failed",
        output: normalized.output,
        errorCode: normalized.errorCode,
        errorMessage: normalized.errorMessage,
        retryable: normalized.retryable,
        actualCostCredits: normalized.actualCostCredits,
        providerCostCents: normalized.providerCostCents,
      });
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: normalized.status,
          externalRef,
        })
        .where(sql`id = ${row.id}`);
      logger.info(
        { eventId: row.id, jobId: job.id, slug, outcome: outcome.kind },
        "Webhook event applied to job",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tx
        .update(providerWebhookEventsTable)
        .set({
          processedAt: new Date(),
          eventType: normalized.status,
          externalRef,
          processError: `applyWebhookUpdate: ${msg}`,
        })
        .where(sql`id = ${row.id}`);
    }
  }
}
