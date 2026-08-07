import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const vslTemplateLinks = pgTable("vsl_template_links", {
  slug: text("slug").primaryKey(),
  url: text("url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
