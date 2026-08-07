import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "../clients";
import { creditWalletsTable } from "./wallets";

export const creditTransactionsTable = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => creditWalletsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reservedBalanceAfter: integer("reserved_balance_after").notNull().default(0),
    reason: text("reason"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyKeyUnique: uniqueIndex("credit_transactions_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    userIdIdx: index("credit_transactions_user_id_idx").on(t.userId),
    walletIdIdx: index("credit_transactions_wallet_id_idx").on(t.walletId),
  }),
);

export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
export type InsertCreditTransaction = typeof creditTransactionsTable.$inferInsert;

export const CREDIT_TX_TYPES = {
  CREDIT: "credit",
  DEBIT: "debit",
  RESERVE: "reserve",
  RELEASE: "release",
  FINALIZE: "finalize",
  ADMIN_ADJUST: "admin_adjust",
  USAGE: "usage",
} as const;

export type CreditTransactionType = (typeof CREDIT_TX_TYPES)[keyof typeof CREDIT_TX_TYPES];
