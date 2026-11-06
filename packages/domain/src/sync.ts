import { DomainError, type ErrorCode } from './errors';

/**
 * Offline-first synchronization queue (spec §24.4, §52).
 *
 * - Every mutation carries a client-generated operation UUID; the server
 *   stores it in `sync_operations` and replays the stored result on repeat
 *   delivery, so retries never duplicate records.
 * - Operations on the same record are applied strictly in order.
 * - The queue NEVER reports `synced` until the server acknowledged the op.
 * - Storage is pluggable (SQLite on device, memory in tests).
 */

export type SyncStatus =
  | 'waiting' // Waiting to sync
  | 'uploading' // Uploading / sending
  | 'synced' // Server acknowledged
  | 'failed' // Failed — retry available (transient)
  | 'conflict' // Conflict — action required
  | 'rejected' // Server refused (validation / permission) — action required
  | 'discarded'; // User reviewed and dropped the local change (kept for traceability)

export const SYNC_STATUS_LABEL_KEYS: Record<SyncStatus | 'saved_on_device', string> = {
  saved_on_device: 'sync.saved_on_device',
  waiting: 'sync.waiting',
  uploading: 'sync.uploading',
  synced: 'sync.synced',
  failed: 'sync.failed',
  conflict: 'sync.conflict',
  rejected: 'sync.rejected',
  discarded: 'sync.discarded',
};

export interface SyncOperation {
  /** Client-generated UUID — the server idempotency key. */
  operationId: string;
  userId: string;
  organizationId: string;
  /** e.g. 'survey.save_draft', 'evidence.register', 'survey.submit'. */
  operationType: string;
  /** Stable key of the record the op mutates (ordering scope). */
  recordKey: string;
  /** Server revision the client based its change on (optimistic concurrency). */
  baseRevision: number | null;
  clientCreatedAt: string;
  payloadVersion: number;
  payload: unknown;
  fileRefs: string[];
  /** Monotonic enqueue sequence for ordering. */
  sequence: number;
  status: SyncStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: ErrorCode | null;
  serverResult: unknown;
}

export interface SyncStore {
  all(): Promise<SyncOperation[]>;
  put(op: SyncOperation): Promise<void>;
}

export class MemorySyncStore implements SyncStore {
  private readonly ops = new Map<string, SyncOperation>();
  async all(): Promise<SyncOperation[]> {
    return [...this.ops.values()].map((o) => ({ ...o }));
  }
  async put(op: SyncOperation): Promise<void> {
    this.ops.set(op.operationId, { ...op });
  }
}

/** Errors worth retrying automatically. Everything else needs a human. */
// AUTH_REQUIRED is transient: the op is retried after the user signs in again.
const TRANSIENT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['UNKNOWN_ERROR', 'OFFLINE_SYNC_REQUIRED', 'FILE_UPLOAD_FAILED', 'AUTH_REQUIRED']);

export function backoffMs(attempts: number, baseMs = 2_000, maxMs = 5 * 60_000): number {
  if (attempts <= 0) return 0;
  return Math.min(maxMs, baseMs * 2 ** (attempts - 1));
}

export type SendFn = (op: SyncOperation) => Promise<unknown>;

export interface NewOperation {
  operationId: string;
  userId: string;
  organizationId: string;
  operationType: string;
  recordKey: string;
  baseRevision: number | null;
  payload: unknown;
  fileRefs?: string[];
  payloadVersion?: number;
}

export class SyncQueue {
  constructor(
    private readonly store: SyncStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async enqueue(input: NewOperation): Promise<SyncOperation> {
    const existing = (await this.store.all()).find((o) => o.operationId === input.operationId);
    if (existing) return existing; // enqueue is idempotent too
    const all = await this.store.all();
    const op: SyncOperation = {
      operationId: input.operationId,
      userId: input.userId,
      organizationId: input.organizationId,
      operationType: input.operationType,
      recordKey: input.recordKey,
      baseRevision: input.baseRevision,
      clientCreatedAt: this.clock().toISOString(),
      payloadVersion: input.payloadVersion ?? 1,
      payload: input.payload,
      fileRefs: input.fileRefs ?? [],
      sequence: all.reduce((m, o) => Math.max(m, o.sequence), 0) + 1,
      status: 'waiting',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      serverResult: null,
    };
    await this.store.put(op);
    return op;
  }

  /**
   * Operations that may be sent now: due, not finished, and every EARLIER op
   * for the same record has synced (a conflict/rejection blocks later ops).
   */
  async due(): Promise<SyncOperation[]> {
    const now = this.clock().getTime();
    const all = (await this.store.all()).sort((a, b) => a.sequence - b.sequence);
    const blockedRecords = new Set<string>();
    const out: SyncOperation[] = [];
    for (const op of all) {
      if (op.status === 'synced' || op.status === 'discarded') continue;
      if (blockedRecords.has(op.recordKey)) continue;
      blockedRecords.add(op.recordKey); // later ops of this record wait for this one
      const ready =
        (op.status === 'waiting' || op.status === 'failed' || op.status === 'uploading') &&
        (op.nextAttemptAt === null || Date.parse(op.nextAttemptAt) <= now);
      if (ready) out.push(op);
    }
    return out;
  }

  /**
   * Send due ops, in order. An op that becomes unblocked because its
   * predecessor just synced is sent in the same flush. Each op is attempted at
   * most once per flush. Returns the updated ops.
   */
  async flush(send: SendFn): Promise<SyncOperation[]> {
    const updated: SyncOperation[] = [];
    const attempted = new Set<string>();
    for (;;) {
      const batch = (await this.due()).filter((o) => !attempted.has(o.operationId));
      if (batch.length === 0) break;
      for (const op of batch) {
        attempted.add(op.operationId);
        updated.push(await this.sendOne(op, send));
      }
    }
    return updated;
  }

  private async sendOne(op: SyncOperation, send: SendFn): Promise<SyncOperation> {
    const sending: SyncOperation = { ...op, status: 'uploading', attempts: op.attempts + 1 };
    await this.store.put(sending);
    try {
      const result = await send(sending);
      const done: SyncOperation = { ...sending, status: 'synced', serverResult: result, lastErrorCode: null, nextAttemptAt: null };
      await this.store.put(done);
      return done;
    } catch (err) {
      const code: ErrorCode = err instanceof DomainError ? err.code : 'UNKNOWN_ERROR';
      let status: SyncStatus;
      if (code === 'DUPLICATE_OPERATION') status = 'synced';
      else if (code === 'REVISION_CONFLICT') status = 'conflict';
      else if (TRANSIENT.has(code)) status = 'failed';
      else status = 'rejected';
      const next =
        status === 'failed' ? new Date(this.clock().getTime() + backoffMs(sending.attempts)).toISOString() : null;
      const failed: SyncOperation = { ...sending, status, lastErrorCode: status === 'synced' ? null : code, nextAttemptAt: next };
      await this.store.put(failed);
      return failed;
    }
  }

  /**
   * The user reviewed a conflict / rejection and chose to drop the local change.
   * The op is kept (status `discarded`) for traceability and stops blocking
   * later operations on the same record. A corrected change must be enqueued
   * as a NEW operation id based on the current server revision.
   */
  async discard(operationId: string): Promise<SyncOperation> {
    const op = (await this.store.all()).find((o) => o.operationId === operationId);
    if (!op) throw new DomainError('NOT_FOUND');
    if (op.status !== 'conflict' && op.status !== 'rejected') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'Only conflicted or rejected operations can be discarded', {
        currentState: op.status,
      });
    }
    const discarded: SyncOperation = { ...op, status: 'discarded', nextAttemptAt: null };
    await this.store.put(discarded);
    return discarded;
  }

  async status(recordKey: string): Promise<SyncStatus | 'none'> {
    const ops = (await this.store.all()).filter((o) => o.recordKey === recordKey);
    if (ops.length === 0) return 'none';
    const order: SyncStatus[] = ['conflict', 'rejected', 'failed', 'uploading', 'waiting', 'synced', 'discarded'];
    for (const s of order) if (ops.some((o) => o.status === s)) return s;
    return 'none';
  }
}

/** Field-level diff for explicit conflict resolution (§52.3). */
export function changedFields(base: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  return [...keys].filter((k) => JSON.stringify(base[k]) !== JSON.stringify(next[k])).sort();
}

export function detectConflict(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  server: Record<string, unknown>,
): { conflicting: string[]; localOnly: string[]; serverOnly: string[] } {
  const l = new Set(changedFields(base, local));
  const s = new Set(changedFields(base, server));
  const conflicting = [...l].filter((k) => s.has(k) && JSON.stringify(local[k]) !== JSON.stringify(server[k]));
  return {
    conflicting,
    localOnly: [...l].filter((k) => !s.has(k)),
    serverOnly: [...s].filter((k) => !l.has(k)),
  };
}
