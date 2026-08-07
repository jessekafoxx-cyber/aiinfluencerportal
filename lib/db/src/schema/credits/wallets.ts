import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "../clients";

export const creditWalletsTable = pgTable(
  "credit_wallets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id"),
    balance: integer("balance").notNull().default(0),
    reservedBalance: integer("reserved_balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userWorkspaceUnique: uniqueIndex("credit_wallets_user_workspace_unique").on(
      t.userId,
      t.workspaceId,
    ),
    userOnlyUnique: uniqueIndex("credit_wallets_user_only_unique")
      .on(t.userId)
      .where(sql`workspace_id IS NULL`),
  }),
);

export type CreditWallet = typeof creditWalletsTable.$inferSelect;
export type InsertCreditWallet = typeof creditWalletsTable.$inferInsert;
