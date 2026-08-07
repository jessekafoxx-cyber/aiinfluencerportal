import { pgTable, serial, integer, text, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const creditPackagesTable = pgTable(
  "credit_packages",
  {
    id: serial("id").primaryKey(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    credits: integer("credits").notNull(),
    priceInCents: integer("price_in_cents").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    skuUnique: uniqueIndex("credit_packages_sku_unique").on(t.sku),
  }),
);

export type CreditPackage = typeof creditPackagesTable.$inferSelect;
export type InsertCreditPackage = typeof creditPackagesTable.$inferInsert;
