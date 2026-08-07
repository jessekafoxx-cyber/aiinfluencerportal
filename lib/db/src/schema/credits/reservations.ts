import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { clientsTable } from "../clients";
import { creditWalletsTable } from "./wallets";

export const creditReservationsTable = pgTable(
  "credit_reservations",
  {
    id: serial("id").primaryKey(),
    walletId: integer("wallet_id")
      .notNull()
      .references(() => creditWalletsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id"),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("held"),
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    finalizedAmount: integer("finalized_amount"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    statusIdx: index("credit_reservations_status_idx").on(t.status),
    jobIdIdx: index("credit_reservations_job_id_idx").on(t.jobId),
    expiresAtIdx: index("credit_reservations_expires_at_idx").on(t.expiresAt),
  }),
);

export type CreditReservation = typeof creditReservationsTable.$inferSelect;
export type InsertCreditReservation = typeof creditReservationsTable.$inferInsert;

export const RESERVATION_STATUS = {
  HELD: "held",
  FINALIZED: "finalized",
  RELEASED: "released",
} as const;

export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];
