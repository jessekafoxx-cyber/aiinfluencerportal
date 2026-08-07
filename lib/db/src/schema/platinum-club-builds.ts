import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Platinum Club "DFY Builds" - a build is a self-contained done-for-you
// library (e.g. "May 2026 - Agency Growth Blueprint", "June 2026 - The
// First-Time Entrepreneur Launchpad"). Admins create / rename / reorder / hide
// builds at runtime, so the set of builds is no longer hardcoded in the portal.
//
// A build OWNS a fixed list of section keys (stored in `sections`). Each
// platinum_club_resources row is bucketed into exactly one of those section
// keys via its `section` column - there is no resource->build foreign key; a
// resource belongs to whichever build lists its section key. Section keys are
// globally unique across builds so a resource is never ambiguous. The seeded
// May build uses the original bare keys (main_offer, bonuses, ...) and the June
// build uses launchpad_-prefixed keys; admin-created builds derive keys from
// their slug (e.g. `<slug>_main_offer`).
//
// Seeding is owned by ensure-platinum-club-builds.ts which is idempotent
// (seed-if-empty only - publish ships the table via ADD TABLE but skips data
// backfills, so the boot loader fills the initial rows).
export const platinumClubBuildsTable = pgTable(
  "platinum_club_builds",
  {
    id: serial("id").primaryKey(),
    // Display label shown to members + admins (e.g. "July 2026 - Launch Kit").
    label: text("label").notNull(),
    // Stable key prefix used to generate this build's section keys at creation
    // time. Never changes on rename. Unique across builds.
    slug: text("slug").notNull().unique(),
    // Ordered section list: [{ key, label }]. `key` is the resource.section
    // value; `label` is the section heading shown in the build.
    sections: jsonb("sections")
      .$type<{ key: string; label: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    activeIdx: index("platinum_club_builds_active_idx").on(t.isActive),
    orderIdx: index("platinum_club_builds_order_idx").on(t.displayOrder),
  }),
);

export const insertPlatinumClubBuildSchema = createInsertSchema(
  platinumClubBuildsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatinumClubBuild = z.infer<typeof insertPlatinumClubBuildSchema>;
export type PlatinumClubBuild = typeof platinumClubBuildsTable.$inferSelect;
export type PlatinumClubBuildSection = { key: string; label: string };
