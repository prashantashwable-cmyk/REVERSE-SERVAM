import * as SQLite from 'expo-sqlite';
import type { SyncOperation, SyncStore } from '@aiec/domain';

/**
 * Durable on-device store (§24.4, §52): cached work package, local drafts and
 * the sync queue survive app termination. Only the assigned surveyor's work
 * package is cached — no unrestricted customer or financial data.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('aiec-field.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_ops (operation_id TEXT PRIMARY KEY NOT NULL, record_key TEXT NOT NULL, sequence INTEGER NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS drafts (survey_id TEXT PRIMARY KEY NOT NULL, revision_id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
      return d;
    })();
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).runAsync('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)', [key, JSON.stringify(value), new Date().toISOString()]);
}

/** Wipe everything on sign-out so the next user never sees another user's work package (the device language choice stays). */
export async function clearLocalData(): Promise<void> {
  await (await db()).execAsync("DELETE FROM kv WHERE key <> 'locale'; DELETE FROM drafts; DELETE FROM sync_ops;");
}

export interface LocalDraft {
  revisionId: string;
  data: Record<string, unknown>;
  measurements: { key: string; entered_value: number; entered_unit: 'mm' | 'cm' | 'm'; level_label?: string }[];
  updatedAt: string;
}

export async function getDraft(surveyId: string): Promise<LocalDraft | null> {
  const row = await (await db()).getFirstAsync<{ json: string }>('SELECT json FROM drafts WHERE survey_id = ?', [surveyId]);
  return row ? (JSON.parse(row.json) as LocalDraft) : null;
}

export async function saveDraft(surveyId: string, draft: LocalDraft): Promise<void> {
  await (await db()).runAsync('INSERT OR REPLACE INTO drafts (survey_id, revision_id, json, updated_at) VALUES (?, ?, ?, ?)', [
    surveyId,
    draft.revisionId,
    JSON.stringify(draft),
    draft.updatedAt,
  ]);
}

/** SQLite-backed SyncStore for the shared @aiec/domain SyncQueue. bigint-free JSON payloads only. */
export class SqliteSyncStore implements SyncStore {
  async all(): Promise<SyncOperation[]> {
    const rows = await (await db()).getAllAsync<{ json: string }>('SELECT json FROM sync_ops ORDER BY sequence');
    return rows.map((r) => JSON.parse(r.json) as SyncOperation);
  }
  async put(op: SyncOperation): Promise<void> {
    await (await db()).runAsync('INSERT OR REPLACE INTO sync_ops (operation_id, record_key, sequence, json) VALUES (?, ?, ?, ?)', [
      op.operationId,
      op.recordKey,
      op.sequence,
      JSON.stringify(op),
    ]);
  }
}
