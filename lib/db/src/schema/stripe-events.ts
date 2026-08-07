import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Webhook idempotency log. Every Stripe event we successfully process
 * inserts a row keyed by `event_id`. Re-deliveries (Stripe retries on
 * non-2xx + duplicate dispatch from dashboard) hit the PK and no-op,
 * which is what makes the webhook handler safe to re-run.
 *
 * `order_id` is denormalised so an ops dashboard can pull "every event
 * we have processed for this order" without scanning the body of every
 * event - useful when reconciling a refund or a dispute.
 */
export const stripeProcessedEventsTable = pgTable(
  "stripe_processed_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    orderId: text("order_id"),
    livemode: boolean("livemode").notNull(),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index("stripe_processed_events_order_idx").on(t.orderId),
    processedAtIdx: index("stripe_processed_events_processed_at_idx").on(t.processedAt),
  }),
);

export type StripeProcessedEvent = typeof stripeProcessedEventsTable.$inferSelect;
