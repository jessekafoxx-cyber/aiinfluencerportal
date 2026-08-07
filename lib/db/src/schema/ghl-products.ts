import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { portalUsersTable } from "./portal";

// ─────────────────────────────────────────────────────────────────────────────
// GoHighLevel-driven product catalog + purchase ledger.
//
// Purchasing lives entirely inside each client's GoHighLevel account. A GHL
// workflow POSTs to the secret-protected purchase webhook
// (POST /api/public/webhooks/ghl?secret=whsec_...) with an email + product
// slug, and the portal grants (or revokes) access. Products are created in
// the admin Products page or imported from the connected GHL account.
//
// Entitlement model: a product can grant full portal access
// (grants_full_portal → portal_users.is_active + orders.main_product_paid +
// enrollment email) and/or a set of add-on entitlement keys (entitlements
// jsonb array) that map onto the boolean paid flags on the orders row (see
// artifacts/api-server/src/lib/ghl-entitlements.ts for the allowlist).
// ─────────────────────────────────────────────────────────────────────────────

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // The webhook identifier: GHL workflows send {"product": "<slug>"}.
  slug: text("slug").notNull().unique(),
  // main | bump | upsell | addon — informational grouping for the admin UI.
  kind: text("kind").notNull().default("main"),
  description: text("description"),
  // Grants full portal access (activation + masterclass + welcome email).
  grantsFullPortal: boolean("grants_full_portal").notNull().default(false),
  // Add-on entitlement keys granted alongside (allowlisted strings that map
  // to orders.*_paid columns — see ENTITLEMENT_DEFS in ghl-entitlements.ts).
  entitlements: jsonb("entitlements").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  // Link back to the GHL product this row was imported from (nullable —
  // manually created products have no GHL linkage).
  ghlProductId: text("ghl_product_id").unique(),
  // GHL-hosted sales/checkout page for this product. When set, locked
  // upgrade surfaces in the portal open this URL in a new tab instead of
  // the "purchasing has moved" contact notice. Entitlements still land via
  // the GHL purchase webhook after the buyer completes checkout there.
  purchaseUrl: text("purchase_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchasesTable = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => portalUsersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    // webhook | api | admin
    source: text("source").notNull().default("webhook"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("purchases_user_idx").on(t.userId),
    productIdx: index("purchases_product_idx").on(t.productId),
    // One ACTIVE purchase per user+product; revoked rows are kept as history.
    // The revoke path relies on this as its idempotency/concurrency gate.
    activeUniq: uniqueIndex("purchases_active_unique")
      .on(t.userId, t.productId)
      .where(sql`revoked_at is null`),
  }),
);

export const webhookEventsTable = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull().default("ghl"),
    // processed | rejected | error | ignored
    status: text("status").notNull(),
    email: text("email"),
    productSlug: text("product_slug"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("webhook_events_created_idx").on(t.createdAt),
  }),
);

export type Product = typeof productsTable.$inferSelect;
export type InsertProduct = typeof productsTable.$inferInsert;
export type Purchase = typeof purchasesTable.$inferSelect;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
