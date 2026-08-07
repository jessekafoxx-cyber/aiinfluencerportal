import type { AutomationJob } from "@workspace/db";

export type { AutomationJob };

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  workspaceId?: number | null;
  userId: number;
  workflowId?: number | null;
  influencerId?: number | null;
  idempotencyKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: AutomationJob;
  enqueued: boolean;
}

export interface ClaimNextInput {
  workerId: string;
  types?: string[];
  lockTtlMs?: number;
  limit?: number;
}

export interface HeartbeatInput {
  jobId: number;
  workerId: string;
}

export interface CompleteInput {
  jobId: number;
  result?: Record<string, unknown>;
  workerId?: string;
}

export interface FailInput {
  jobId: number;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  workerId?: string;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface CancelInput {
  jobId: number;
  reason?: string;
}

export interface RequeueStuckInput {
  olderThanMs: number;
  limit?: number;
}

export interface AppendEventInput {
  jobId: number;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export class JobNotFoundError extends Error {
  code = "JOB_NOT_FOUND";
  constructor(public jobId: number) {
    super(`Job ${jobId} not found`);
    this.name = "JobNotFoundError";
  }
}

export class JobLockMismatchError extends Error {
  code = "JOB_LOCK_MISMATCH";
  constructor(public jobId: number, public workerId: string) {
    super(`Job ${jobId} is not locked by worker ${workerId}`);
    this.name = "JobLockMismatchError";
  }
}
