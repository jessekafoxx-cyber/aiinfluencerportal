import { pgTable, serial, text, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";

// Catalog of pre-generated DFY content scripts shown on the
// "1,000+ Proven Content Scripts" sub-page under Done For You Pack.
// Seeded once via the seed-dfy-scripts script; users only read.
export const dfyScriptsTable = pgTable(
  "dfy_scripts",
  {
    id: serial("id").primaryKey(),
    // One of the 9 Script Writer OS slugs:
    // "green-screen" | "hook-demo" | "podcast-clip" | "speaking-clip" |
    // "selfie-clip" | "slideshow" | "carousel" | "overlay" | "fastmotion"
    type: varchar("type", { length: 32 }).notNull(),
    hook: text("hook").notNull(),
    body: text("body").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    typeIdx: index("dfy_scripts_type_idx").on(t.type),
    sortIdx: index("dfy_scripts_sort_idx").on(t.sortOrder),
  }),
);

export type DfyScript = typeof dfyScriptsTable.$inferSelect;
