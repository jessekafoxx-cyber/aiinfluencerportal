export interface CreditWalletSummary {
  userId: number;
  balance: number;
  reservedBalance: number;
  availableBalance: number;
}

export interface CreditOpResult {
  walletId: number;
  userId: number;
  balance: number;
  reservedBalance: number;
  transactionId: number | null;
  idempotent: boolean;
}

export interface ReserveResult {
  reservationId: number;
  walletId: number;
  amount: number;
  status: "held" | "finalized" | "released";
  idempotent: boolean;
  balance: number;
  reservedBalance: number;
}

export interface FinalizeResult {
  reservationId: number;
  actualAmount: number;
  releasedAmount: number;
  status: "finalized";
  balance: number;
  reservedBalance: number;
}

export interface ReleaseResult {
  reservationId: number;
  releasedAmount: number;
  status: "released";
  balance: number;
  reservedBalance: number;
}

export interface UsageEventResult {
  usageEventId: number;
}

export interface ProviderCostEventResult {
  providerCostEventId: number;
}

export class InsufficientCreditsError extends Error {
  code = "INSUFFICIENT_CREDITS";
  constructor(
    public userId: number,
    public requested: number,
    public available: number,
  ) {
    super(`Insufficient credits for user ${userId}: requested ${requested}, available ${available}`);
    this.name = "InsufficientCreditsError";
  }
}

export class WalletNotFoundError extends Error {
  code = "WALLET_NOT_FOUND";
  constructor(public userId: number) {
    super(`Credit wallet not found for user ${userId}`);
    this.name = "WalletNotFoundError";
  }
}

export class ReservationNotFoundError extends Error {
  code = "RESERVATION_NOT_FOUND";
  constructor(public reservationId: number) {
    super(`Reservation not found: ${reservationId}`);
    this.name = "ReservationNotFoundError";
  }
}

export class InvalidReservationStateError extends Error {
  code = "INVALID_RESERVATION_STATE";
  constructor(public reservationId: number, public currentStatus: string) {
    super(`Reservation ${reservationId} has status '${currentStatus}' and cannot be modified`);
    this.name = "InvalidReservationStateError";
  }
}
