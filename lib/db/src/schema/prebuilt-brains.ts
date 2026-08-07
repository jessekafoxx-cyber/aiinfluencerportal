import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

// Catalog of "pre-built brains" that portal users can pick from the
// "Choose A Pre-Built Brain" picker on Your Brain. Each row is one offer
// the platform sells / promotes (the AI Influencer Portfolio is the seed
// example). Admins manage these from /admin/prebuilt-brains so the catalog
// can grow as new offers launch without code changes.
export const prebuiltBrainsTable = pgTable("prebuilt_brains", {
  // Slug-style id (e.g. "ai-influencer-portfolio"). Stable across renames so
  // existing user_brain_profiles.selected_prebuilt_brain_id keeps resolving.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  shortDescription: text("short_description").notNull().default(""),
  audience: text("audience").notNull().default(""),
  highlights: jsonb("highlights").notNull().default([]),
  badge: text("badge"),
  comingSoon: boolean("coming_soon").notNull().default(false),
  // brainData is the structured positioning shown to users when they pick
  // this brain. Shape: { name, companyName, whoDoYouHelp, howDoYouHelpThem,
  // keyAchievements }. JSON so it stays loose as the schema evolves.
  brainData: jsonb("brain_data").notNull().default({}),
  // The big markdown brain document that gets injected into every OS tool
  // prompt when this brain is the active one.
  generatedBrain: text("generated_brain").notNull().default(""),
  // Catch-all source notes the admin pastes in (research dumps, copy from
  // sales pages, etc.). Surfaced on the admin edit screen so the agent can
  // pull from it when authoring the generated brain.
  sourceNotes: text("source_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Source documents an admin uploads alongside a brain (sales pages, PDFs,
// transcripts, screenshots, etc.). Files live in object storage; the row
// just records the metadata + a serve path. extractedText is optional plain
// text (for files where the admin pasted the contents) so the agent can
// read the source material directly when generating brain content.
export const prebuiltBrainDocumentsTable = pgTable("prebuilt_brain_documents", {
  id: serial("id").primaryKey(),
  brainId: text("brain_id")
    .notNull()
    .references(() => prebuiltBrainsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  fileName: text("file_name"),
  originalName: text("original_name"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  servePath: text("serve_path"),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PrebuiltBrainRow = typeof prebuiltBrainsTable.$inferSelect;
export type PrebuiltBrainDocument = typeof prebuiltBrainDocumentsTable.$inferSelect;
