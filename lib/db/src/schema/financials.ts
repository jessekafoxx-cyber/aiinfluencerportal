import { pgTable, serial, text, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const kpiEntries = pgTable("kpi_entries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  value: numeric("value").notNull(),
  target: numeric("target"),
  unit: text("unit").notNull().default("number"),
  period: text("period").notNull().default("monthly"),
  category: text("category").notNull().default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertKpiSchema = createInsertSchema(kpiEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type KpiEntry = typeof kpiEntries.$inferSelect;
export type InsertKpiEntry = z.infer<typeof insertKpiSchema>;

export const financialEntries = pgTable("financial_entries", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount").notNull(),
  entryDate: date("entry_date").notNull(),
  source: text("source").notNull().default("manual"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertFinancialSchema = createInsertSchema(financialEntries).omit({
  id: true,
  createdAt: true,
});

export type FinancialEntry = typeof financialEntries.$inferSelect;
export type InsertFinancialEntry = z.infer<typeof insertFinancialSchema>;
