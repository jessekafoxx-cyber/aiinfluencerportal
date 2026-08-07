import { sql, and, eq, isNull } from "drizzle-orm";
import type { db as DB } from "@workspace/db";
import {
  creditWalletsTable,
  creditTransactionsTable,
  creditReservationsTable,
  usageEventsTable,
  providerCostEventsTable,
  automationJobsTable,
  CREDIT_TX_TYPES,
  RESERVATION_STATUS,
  type CreditWallet,
  type CreditReservation,
  type CreditTransaction,
} from "@workspace/db";
import {
  InsufficientCreditsError,
  WalletNotFoundError,
  ReservationNotFoundError,
  InvalidReservationStateError,
  type CreditWalletSummary,
  type CreditOpResult,
  type ReserveResult,
  type FinalizeResult,
  type ReleaseResult,
  type UsageEventResult,
  type ProviderCostEventResult,
} from "./types";

type Db = typeof DB;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const PG_UNIQUE_VIOLATION = "23505";

export interface CreditEngineOptions {
  db: Db;
}

export interface WalletKey {
  userId: number;
  workspaceId?: number | null;
}

export interface CreditWalletInput extends WalletKey {
  amount: number;
  reason?: string;
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ReserveInput extends WalletKey {
  jobId?: number | null;
  amount: number;
  reason?: string;
  expiresAt?: Date;
  idempotencyKey: string;
}

export interface FinalizeInput {
  reservationId: number;
  actualAmount: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface ReleaseInput {
  reservationId: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface AdminAdjustInput extends WalletKey {
  delta: number;
  reason: string;
  adminId: number | string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordUsageInput {
  jobId: number;
  providerSlug: string;
  units: number;
  costCredits?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordProviderCostInput {
  providerSlug: string;
  externalRef?: string;
  costInCents: number;
  units?: number;
  metadata?: Record<string, unknown>;
}

export class CreditEngine {
  private readonly db: Db;

  constructor(opts: CreditEngineOptions) {
    this.db = opts.db;
  }

  async getBalance(key: WalletKey | number): Promise<CreditWalletSummary> {
    const walletKey = typeof key === "number" ? { userId: key, workspaceId: null } : { userId: key.userId, workspaceId: key.workspaceId ?? null };
    const wallet = await this.findOrCreateWallet(walletKey);
    return summarize(wallet);
  }

  async creditWallet(input: CreditWalletInput): Promise<CreditOpResult> {
    if (input.amount <= 0) {
      throw new Error("creditWallet amount must be > 0");
    }
    return this.runWithIdempotency(input.idempotencyKey, async (tx) => {
      const wallet = await this.lockOrCreateWallet(tx, { userId: input.userId, workspaceId: input.workspaceId ?? null });
      const newBalance = wallet.balance + input.amount;
      await tx
        .update(creditWalletsTable)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(creditWalletsTable.id, wallet.id));

      const txRow = await this.insertTransaction(tx, {
        walletId: wallet.id,
        userId: input.userId,
        type: CREDIT_TX_TYPES.CREDIT,
        amount: input.amount,
        balanceAfter: newBalance,
        reservedBalanceAfter: wallet.reservedBalance,
        reason: input.reason,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      return {
        walletId: wallet.id,
        userId: input.userId,
        balance: newBalance,
        reservedBalance: wallet.reservedBalance,
        transactionId: txRow.id,
        idempotent: false,
      };
    });
  }

  async debitWallet(input: CreditWalletInput): Promise<CreditOpResult> {
    if (input.amount <= 0) {
      throw new Error("debitWallet amount must be > 0");
    }
    return this.runWithIdempotency(input.idempotencyKey, async (tx) => {
      const wallet = await this.lockWallet(tx, { userId: input.userId, workspaceId: input.workspaceId ?? null });
      const available = wallet.balance - wallet.reservedBalance;
      if (available < input.amount) {
        throw new InsufficientCreditsError(input.userId, input.amount, available);
      }
      const newBalance = wallet.balance - input.amount;
      await tx
        .update(creditWalletsTable)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(creditWalletsTable.id, wallet.id));

      const txRow = await this.insertTransaction(tx, {
        walletId: wallet.id,
        userId: input.userId,
        type: CREDIT_TX_TYPES.DEBIT,
        amount: -input.amount,
        balanceAfter: newBalance,
        reservedBalanceAfter: wallet.reservedBalance,
        reason: input.reason,
        refType: input.refType,
        refId: input.refId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      return {
        walletId: wallet.id,
        userId: input.userId,
        balance: newBalance,
        reservedBalance: wallet.reservedBalance,
        transactionId: txRow.id,
        idempotent: false,
      };
    });
  }

  async reserveCredits(input: ReserveInput): Promise<ReserveResult> {
    if (input.amount <= 0) {
      throw new Error("reserveCredits amount must be > 0");
    }
    if (!input.idempotencyKey) {
      throw new Error("reserveCredits requires idempotencyKey");
    }

    try {
      return await this.db.transaction(async (tx) => {
        const replay = await this.findReserveReplay(tx, input.idempotencyKey);
        if (replay) return replay;

        const wallet = await this.lockOrCreateWallet(tx, { userId: input.userId, workspaceId: input.workspaceId ?? null });
        const available = wallet.balance - wallet.reservedBalance;
        if (available < input.amount) {
          throw new InsufficientCreditsError(input.userId, input.amount, available);
        }
        const newReserved = wallet.reservedBalance + input.amount;
        await tx
          .update(creditWalletsTable)
          .set({ reservedBalance: newReserved, updatedAt: new Date() })
          .where(eq(creditWalletsTable.id, wallet.id));

        const [reservation] = await tx
          .insert(creditReservationsTable)
          .values({
            walletId: wallet.id,
            userId: input.userId,
            jobId: input.jobId ?? null,
            amount: input.amount,
            status: RESERVATION_STATUS.HELD,
            reason: input.reason,
            expiresAt: input.expiresAt,
          })
          .returning();

        await this.insertTransaction(tx, {
          walletId: wallet.id,
          userId: input.userId,
          type: CREDIT_TX_TYPES.RESERVE,
          amount: 0,
          balanceAfter: wallet.balance,
          reservedBalanceAfter: newReserved,
          reason: input.reason ?? "reserve",
          refType: "reservation",
          refId: String(reservation!.id),
          idempotencyKey: input.idempotencyKey,
        });

        return {
          reservationId: reservation!.id,
          walletId: wallet.id,
          amount: input.amount,
          status: "held" as const,
          idempotent: false,
          balance: wallet.balance,
          reservedBalance: newReserved,
        };
      });
    } catch (err) {
      if (err instanceof IdempotencyReplay || isUniqueViolation(err)) {
        const replay = await this.findReserveReplay(this.db, input.idempotencyKey);
        if (replay) return { ...replay, idempotent: true };
      }
      throw err;
    }
  }

  async finalizeReservation(input: FinalizeInput): Promise<FinalizeResult> {
    if (input.actualAmount < 0) {
      throw new Error("finalizeReservation actualAmount must be >= 0");
    }
    try {
      return await this.db.transaction(async (tx) => {
        if (input.idempotencyKey) {
          const replay = await this.findTxReplay(tx, input.idempotencyKey);
          if (replay) {
            const reservation = await this.fetchReservation(tx, input.reservationId);
            return {
              reservationId: reservation.id,
              actualAmount: reservation.finalizedAmount ?? input.actualAmount,
              releasedAmount: reservation.amount - (reservation.finalizedAmount ?? input.actualAmount),
              status: "finalized" as const,
              balance: replay.balance,
              reservedBalance: replay.reservedBalance,
            };
          }
        }
        const reservation = await this.lockReservation(tx, input.reservationId);
        if (reservation.status !== RESERVATION_STATUS.HELD) {
          throw new InvalidReservationStateError(reservation.id, reservation.status);
        }
        const actualAmount = Math.min(input.actualAmount, reservation.amount);
        const releasedAmount = reservation.amount - actualAmount;

        const wallet = await this.lockWalletById(tx, reservation.walletId);
        const newReserved = wallet.reservedBalance - reservation.amount;
        const newBalance = wallet.balance - actualAmount;

        await tx
          .update(creditWalletsTable)
          .set({
            balance: newBalance,
            reservedBalance: newReserved,
            updatedAt: new Date(),
          })
          .where(eq(creditWalletsTable.id, wallet.id));

        await tx
          .update(creditReservationsTable)
          .set({
            status: RESERVATION_STATUS.FINALIZED,
            finalizedAmount: actualAmount,
            finalizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(creditReservationsTable.id, reservation.id));

        await this.insertTransaction(tx, {
          walletId: wallet.id,
          userId: reservation.userId,
          type: CREDIT_TX_TYPES.FINALIZE,
          amount: -actualAmount,
          balanceAfter: newBalance,
          reservedBalanceAfter: newReserved,
          reason: input.reason ?? "finalize",
          refType: "reservation",
          refId: String(reservation.id),
          idempotencyKey: input.idempotencyKey,
        });

        return {
          reservationId: reservation.id,
          actualAmount,
          releasedAmount,
          status: "finalized" as const,
          balance: newBalance,
          reservedBalance: newReserved,
        };
      });
    } catch (err) {
      if ((err instanceof IdempotencyReplay || isUniqueViolation(err)) && input.idempotencyKey) {
        const replay = await this.findTxReplay(this.db, input.idempotencyKey);
        if (replay) {
          const reservation = await this.fetchReservation(this.db, input.reservationId);
          return {
            reservationId: reservation.id,
            actualAmount: reservation.finalizedAmount ?? input.actualAmount,
            releasedAmount: reservation.amount - (reservation.finalizedAmount ?? input.actualAmount),
            status: "finalized" as const,
            balance: replay.balance,
            reservedBalance: replay.reservedBalance,
          };
        }
      }
      throw err;
    }
  }

  async releaseReservation(input: ReleaseInput): Promise<ReleaseResult> {
    try {
      return await this.db.transaction(async (tx) => {
        if (input.idempotencyKey) {
          const replay = await this.findTxReplay(tx, input.idempotencyKey);
          if (replay) {
            const reservation = await this.fetchReservation(tx, input.reservationId);
            return {
              reservationId: reservation.id,
              releasedAmount: reservation.amount,
              status: "released" as const,
              balance: replay.balance,
              reservedBalance: replay.reservedBalance,
            };
          }
        }
        const reservation = await this.lockReservation(tx, input.reservationId);
        if (reservation.status !== RESERVATION_STATUS.HELD) {
          throw new InvalidReservationStateError(reservation.id, reservation.status);
        }
        const wallet = await this.lockWalletById(tx, reservation.walletId);
        const newReserved = wallet.reservedBalance - reservation.amount;

        await tx
          .update(creditWalletsTable)
          .set({ reservedBalance: newReserved, updatedAt: new Date() })
          .where(eq(creditWalletsTable.id, wallet.id));

        await tx
          .update(creditReservationsTable)
          .set({
            status: RESERVATION_STATUS.RELEASED,
            releasedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(creditReservationsTable.id, reservation.id));

        await this.insertTransaction(tx, {
          walletId: wallet.id,
          userId: reservation.userId,
          type: CREDIT_TX_TYPES.RELEASE,
          amount: 0,
          balanceAfter: wallet.balance,
          reservedBalanceAfter: newReserved,
          reason: input.reason ?? "release",
          refType: "reservation",
          refId: String(reservation.id),
          idempotencyKey: input.idempotencyKey,
        });

        return {
          reservationId: reservation.id,
          releasedAmount: reservation.amount,
          status: "released" as const,
          balance: wallet.balance,
          reservedBalance: newReserved,
        };
      });
    } catch (err) {
      if ((err instanceof IdempotencyReplay || isUniqueViolation(err)) && input.idempotencyKey) {
        const replay = await this.findTxReplay(this.db, input.idempotencyKey);
        if (replay) {
          const reservation = await this.fetchReservation(this.db, input.reservationId);
          return {
            reservationId: reservation.id,
            releasedAmount: reservation.amount,
            status: "released" as const,
            balance: replay.balance,
            reservedBalance: replay.reservedBalance,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Returns the reservation row for the given id, or null if not found.
   * Used by WorkflowRunner's validateReservation callback to confirm that a
   * reservation is `held` and belongs to the active job before any guarded
   * provider (Claude, HeyGen, Blotato, Creatomate) executes.
   */
  async getReservation(id: number): Promise<CreditReservation | null> {
    const rows = await this.db
      .select()
      .from(creditReservationsTable)
      .where(eq(creditReservationsTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async adminAdjust(input: AdminAdjustInput): Promise<CreditOpResult> {
    if (input.delta === 0) {
      throw new Error("adminAdjust delta must be non-zero");
    }
    return this.runWithIdempotency(input.idempotencyKey, async (tx) => {
      const wallet = await this.lockOrCreateWallet(tx, { userId: input.userId, workspaceId: input.workspaceId ?? null });
      const newBalance = wallet.balance + input.delta;
      if (input.delta < 0) {
        const available = wallet.balance - wallet.reservedBalance;
        if (available < Math.abs(input.delta)) {
          throw new InsufficientCreditsError(input.userId, Math.abs(input.delta), available);
        }
      }
      if (newBalance < wallet.reservedBalance) {
        throw new InsufficientCreditsError(
          input.userId,
          Math.abs(input.delta),
          wallet.balance - wallet.reservedBalance,
        );
      }
      await tx
        .update(creditWalletsTable)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(creditWalletsTable.id, wallet.id));

      const txRow = await this.insertTransaction(tx, {
        walletId: wallet.id,
        userId: input.userId,
        type: CREDIT_TX_TYPES.ADMIN_ADJUST,
        amount: input.delta,
        balanceAfter: newBalance,
        reservedBalanceAfter: wallet.reservedBalance,
        reason: input.reason,
        refType: "admin",
        refId: String(input.adminId),
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });

      return {
        walletId: wallet.id,
        userId: input.userId,
        balance: newBalance,
        reservedBalance: wallet.reservedBalance,
        transactionId: txRow.id,
        idempotent: false,
      };
    });
  }

  async recordUsage(input: RecordUsageInput): Promise<UsageEventResult> {
    const jobRows = await this.db
      .select({
        userId: automationJobsTable.userId,
        workspaceId: automationJobsTable.workspaceId,
      })
      .from(automationJobsTable)
      .where(eq(automationJobsTable.id, input.jobId))
      .limit(1);
    if (jobRows.length === 0) {
      throw new Error(`recordUsage: job ${input.jobId} not found`);
    }
    const { userId, workspaceId } = jobRows[0]!;

    const [row] = await this.db
      .insert(usageEventsTable)
      .values({
        userId,
        workspaceId: workspaceId ?? null,
        jobId: input.jobId,
        providerSlug: input.providerSlug,
        units: input.units,
        costCredits: input.costCredits ?? 0,
        metadata: input.metadata,
      })
      .returning({ id: usageEventsTable.id });
    return { usageEventId: row!.id };
  }

  async recordProviderCost(input: RecordProviderCostInput): Promise<ProviderCostEventResult> {
    const [row] = await this.db
      .insert(providerCostEventsTable)
      .values({
        providerSlug: input.providerSlug,
        externalRef: input.externalRef,
        costInCents: input.costInCents,
        units: input.units ?? 0,
        metadata: input.metadata,
      })
      .returning({ id: providerCostEventsTable.id });
    return { providerCostEventId: row!.id };
  }

  private async runWithIdempotency<T extends CreditOpResult>(
    idempotencyKey: string | undefined,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        const replay = await this.findTxReplay(tx, idempotencyKey);
        if (replay) return replay as T;
        return work(tx);
      });
    } catch (err) {
      if (err instanceof IdempotencyReplay) {
        return mapTxToOpResult(err.existing) as T;
      }
      if (isUniqueViolation(err) && idempotencyKey) {
        const replay = await this.findTxReplay(this.db, idempotencyKey);
        if (replay) return replay as T;
      }
      throw err;
    }
  }

  private async findOrCreateWallet(key: { userId: number; workspaceId: number | null }): Promise<CreditWallet> {
    const existing = await this.fetchWallet(this.db, key);
    if (existing) return existing;
    return this.db.transaction(async (tx) => this.lockOrCreateWallet(tx, key));
  }

  private async lockOrCreateWallet(
    tx: Tx,
    key: { userId: number; workspaceId: number | null },
  ): Promise<CreditWallet> {
    const locked = await this.lockWalletIfExists(tx, key);
    if (locked) return locked;
    const conflictTarget =
      key.workspaceId == null
        ? sql`("user_id") WHERE "workspace_id" IS NULL`
        : sql`("user_id", "workspace_id")`;
    await tx.execute(sql`
      INSERT INTO ${creditWalletsTable} ("user_id", "workspace_id", "balance", "reserved_balance")
      VALUES (${key.userId}, ${key.workspaceId}, 0, 0)
      ON CONFLICT ${conflictTarget} DO NOTHING
    `);
    const reFetched = await this.lockWalletIfExists(tx, key);
    if (reFetched) return reFetched;
    throw new WalletNotFoundError(key.userId);
  }

  private async lockWallet(
    tx: Tx,
    key: { userId: number; workspaceId: number | null },
  ): Promise<CreditWallet> {
    const wallet = await this.lockWalletIfExists(tx, key);
    if (!wallet) throw new WalletNotFoundError(key.userId);
    return wallet;
  }

  private async lockWalletIfExists(
    tx: Tx,
    key: { userId: number; workspaceId: number | null },
  ): Promise<CreditWallet | null> {
    const wsClause =
      key.workspaceId == null
        ? sql`${creditWalletsTable.workspaceId} IS NULL`
        : sql`${creditWalletsTable.workspaceId} = ${key.workspaceId}`;
    const locked = await tx.execute(
      sql`SELECT * FROM ${creditWalletsTable} WHERE ${creditWalletsTable.userId} = ${key.userId} AND ${wsClause} FOR UPDATE`,
    );
    const rows = (locked as { rows: unknown[] }).rows ?? (locked as unknown as unknown[]);
    if (Array.isArray(rows) && rows.length > 0) {
      return mapWalletRow(rows[0] as Record<string, unknown>);
    }
    return null;
  }

  private async lockWalletById(tx: Tx, walletId: number): Promise<CreditWallet> {
    const locked = await tx.execute(
      sql`SELECT * FROM ${creditWalletsTable} WHERE ${creditWalletsTable.id} = ${walletId} FOR UPDATE`,
    );
    const rows = (locked as { rows: unknown[] }).rows ?? (locked as unknown as unknown[]);
    if (Array.isArray(rows) && rows.length > 0) {
      return mapWalletRow(rows[0] as Record<string, unknown>);
    }
    throw new Error(`wallet ${walletId} not found`);
  }

  private async fetchWallet(
    runner: Db | Tx,
    key: { userId: number; workspaceId: number | null },
  ): Promise<CreditWallet | null> {
    const where =
      key.workspaceId == null
        ? and(eq(creditWalletsTable.userId, key.userId), isNull(creditWalletsTable.workspaceId))
        : and(eq(creditWalletsTable.userId, key.userId), eq(creditWalletsTable.workspaceId, key.workspaceId));
    const rows = await runner.select().from(creditWalletsTable).where(where).limit(1);
    return rows[0] ?? null;
  }

  private async lockReservation(tx: Tx, reservationId: number) {
    const locked = await tx.execute(
      sql`SELECT * FROM ${creditReservationsTable} WHERE ${creditReservationsTable.id} = ${reservationId} FOR UPDATE`,
    );
    const rows = (locked as { rows: unknown[] }).rows ?? (locked as unknown as unknown[]);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ReservationNotFoundError(reservationId);
    }
    return mapReservationRow(rows[0] as Record<string, unknown>);
  }

  private async fetchReservation(runner: Db | Tx, reservationId: number) {
    const rows = await runner
      .select()
      .from(creditReservationsTable)
      .where(eq(creditReservationsTable.id, reservationId))
      .limit(1);
    if (rows.length === 0) throw new ReservationNotFoundError(reservationId);
    return rows[0]!;
  }

  private async findTxReplay(
    runner: Db | Tx,
    idempotencyKey: string | undefined,
  ): Promise<CreditOpResult | null> {
    if (!idempotencyKey) return null;
    const existing = await runner
      .select()
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing.length === 0) return null;
    const row = existing[0]!;
    return {
      walletId: row.walletId,
      userId: row.userId,
      balance: row.balanceAfter,
      reservedBalance: row.reservedBalanceAfter,
      transactionId: row.id,
      idempotent: true,
    };
  }

  private async findReserveReplay(
    runner: Db | Tx,
    idempotencyKey: string,
  ): Promise<ReserveResult | null> {
    const existing = await runner
      .select()
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing.length === 0) return null;
    const tx = existing[0]!;
    if (tx.refType !== "reservation" || !tx.refId) return null;
    const reservationId = Number(tx.refId);
    const reservation = await this.fetchReservation(runner, reservationId);
    return {
      reservationId,
      walletId: tx.walletId,
      amount: reservation.amount,
      status: reservation.status as ReserveResult["status"],
      idempotent: true,
      balance: tx.balanceAfter,
      reservedBalance: tx.reservedBalanceAfter,
    };
  }

  private async insertTransaction(
    tx: Tx,
    values: {
      walletId: number;
      userId: number;
      type: string;
      amount: number;
      balanceAfter: number;
      reservedBalanceAfter: number;
      reason?: string | null;
      refType?: string | null;
      refId?: string | null;
      idempotencyKey?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<CreditTransaction> {
    if (values.idempotencyKey) {
      const inserted = await tx
        .insert(creditTransactionsTable)
        .values({
          walletId: values.walletId,
          userId: values.userId,
          type: values.type,
          amount: values.amount,
          balanceAfter: values.balanceAfter,
          reservedBalanceAfter: values.reservedBalanceAfter,
          reason: values.reason ?? null,
          refType: values.refType ?? null,
          refId: values.refId ?? null,
          idempotencyKey: values.idempotencyKey,
          metadata: values.metadata ?? null,
        })
        .onConflictDoNothing({
          target: creditTransactionsTable.idempotencyKey,
          where: sql`${creditTransactionsTable.idempotencyKey} IS NOT NULL`,
        })
        .returning();
      if (inserted[0]) return inserted[0];
      const existing = await tx
        .select()
        .from(creditTransactionsTable)
        .where(eq(creditTransactionsTable.idempotencyKey, values.idempotencyKey))
        .limit(1);
      if (existing[0]) {
        throw new IdempotencyReplay(existing[0]);
      }
      throw new Error("insertTransaction: failed to insert and could not find existing row");
    }
    const [row] = await tx
      .insert(creditTransactionsTable)
      .values({
        walletId: values.walletId,
        userId: values.userId,
        type: values.type,
        amount: values.amount,
        balanceAfter: values.balanceAfter,
        reservedBalanceAfter: values.reservedBalanceAfter,
        reason: values.reason ?? null,
        refType: values.refType ?? null,
        refId: values.refId ?? null,
        idempotencyKey: null,
        metadata: values.metadata ?? null,
      })
      .returning();
    return row!;
  }
}

class IdempotencyReplay extends Error {
  constructor(public readonly existing: CreditTransaction) {
    super("idempotency replay");
  }
}

function mapTxToOpResult(row: CreditTransaction): CreditOpResult {
  return {
    walletId: row.walletId,
    userId: row.userId,
    balance: row.balanceAfter,
    reservedBalance: row.reservedBalanceAfter,
    transactionId: row.id,
    idempotent: true,
  };
}

function summarize(wallet: CreditWallet): CreditWalletSummary {
  return {
    userId: wallet.userId,
    balance: wallet.balance,
    reservedBalance: wallet.reservedBalance,
    availableBalance: wallet.balance - wallet.reservedBalance,
  };
}

function mapWalletRow(row: Record<string, unknown>): CreditWallet {
  return {
    id: Number(row["id"]),
    userId: Number(row["user_id"]),
    workspaceId: row["workspace_id"] == null ? null : Number(row["workspace_id"]),
    balance: Number(row["balance"]),
    reservedBalance: Number(row["reserved_balance"]),
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

function mapReservationRow(row: Record<string, unknown>) {
  return {
    id: Number(row["id"]),
    walletId: Number(row["wallet_id"]),
    userId: Number(row["user_id"]),
    jobId: row["job_id"] == null ? null : Number(row["job_id"]),
    amount: Number(row["amount"]),
    status: String(row["status"]),
    reason: (row["reason"] as string | null) ?? null,
    expiresAt: (row["expires_at"] as Date | null) ?? null,
    finalizedAmount: row["finalized_amount"] == null ? null : Number(row["finalized_amount"]),
    finalizedAt: (row["finalized_at"] as Date | null) ?? null,
    releasedAt: (row["released_at"] as Date | null) ?? null,
    createdAt: row["created_at"] as Date,
    updatedAt: row["updated_at"] as Date,
  };
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (e.code === PG_UNIQUE_VIOLATION) return true;
  if (e.cause && typeof e.cause === "object" && (e.cause as { code?: unknown }).code === PG_UNIQUE_VIOLATION) return true;
  return false;
}
