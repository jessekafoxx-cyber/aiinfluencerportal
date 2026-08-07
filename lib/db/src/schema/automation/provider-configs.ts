import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const providerConfigsTable = pgTable(
  "provider_configs",
  {
    id: serial("id").primaryKey(),
    providerSlug: text("provider_slug").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerKeyUnique: uniqueIndex("provider_configs_provider_key_unique").on(
      t.providerSlug,
      t.key,
    ),
  }),
);

export type ProviderConfig = typeof providerConfigsTable.$inferSelect;
export type InsertProviderConfig = typeof providerConfigsTable.$inferInsert;
