/**
 * Credit reservation guard for provider adapters.
 *
 * The four "expensive" providers — Claude, HeyGen, Blotato, and Creatomate —
 * must never execute unless a held credit reservation has been validated.
 * This module defines the constants, error class, and validator contract that
 * ProviderExecutor uses to enforce that requirement.
 */

/** Providers that require a held credit reservation before any API call. */
export const CREDIT_GUARDED_PROVIDERS = new Set<string>([
  "claude",
  "heygen",
  "blotato",
  "creatomate",
]);

/**
 * Thrown (non-retryably) when a guarded provider is invoked without a valid
 * held credit reservation. The WorkflowRunner surfaces this as a terminal
 * CREDIT_RESERVATION_REQUIRED failure and releases any existing reservation.
 */
export class CreditReservationRequiredError extends Error {
  readonly code = "CREDIT_RESERVATION_REQUIRED";
  readonly retryable = false;

  constructor(reason: string, provider?: string) {
    super(provider ? `[${provider}] ${reason}` : reason);
    this.name = "CreditReservationRequiredError";
  }
}

/**
 * Minimal context passed to the ReservationValidator so it can verify the
 * reservation row against the active job without carrying a full DB handle
 * into the adapter layer.
 */
export interface ReservationContext {
  reservationId: number;
  jobId: number;
  userId: number;
  workspaceId?: number | null;
}

/**
 * Callback contract for validating a reservation at execution time.
 * Should throw CreditReservationRequiredError (or a subclass) when the
 * reservation is absent, not `held`, or mismatched with the context.
 */
export type ReservationValidator = (
  ctx: ReservationContext,
) => Promise<void> | void;
