import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const providerWebhookEventsTable = pgTable(
  "provider_webhook_events",
  {
    id: serial("id").primaryKey(),
    providerSlug: text("provider_slug").notNull(),
    externalRef: text("external_ref"),
    eventType: text("event_type"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processError: text("process_error"),
    dedupeKey: text("dedupe_key"),
  },
  (t) => ({
    providerExternalIdx: index("provider_webhook_events_provider_external_idx").on(
      t.providerSlug,
      t.externalRef,
    ),
    dedupeUnique: uniqueIndex("provider_webhook_events_dedupe_unique")
      .on(t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    // Persistence-level external-ref dedupe: two webhook events with the
    // same (providerSlug, externalRef) can never coexist, even if their
    // raw bodies (and therefore dedupeKey) differ — required because
    // providers sometimes vary serialization across retries.
    providerExternalUnique: uniqueIndex(
      "provider_webhook_events_provider_external_unique",
    )
      .on(t.providerSlug, t.externalRef)
      .where(sql`external_ref IS NOT NULL`),
  }),
);

export type ProviderWebhookEvent = typeof providerWebhookEventsTable.$inferSelect;
export type InsertProviderWebhookEvent = typeof providerWebhookEventsTable.$inferInsert;
