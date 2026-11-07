/**
 * Android SecureStore values should stay small (a Supabase session JSON can be
 * several KB). Values are split into fixed-size chunks under derived keys.
 * Pure functions so they are unit-testable without a device.
 */
export const CHUNK_SIZE = 1800;

/** SecureStore keys may only contain [A-Za-z0-9._-]. */
export function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function chunkKey(key: string, index: number): string {
  return `${safeKey(key)}.${index}`;
}

export function countKey(key: string): string {
  return `${safeKey(key)}.n`;
}

export function splitValue(value: string, size = CHUNK_SIZE): string[] {
  if (size <= 0) throw new RangeError('size must be positive');
  if (value.length === 0) return [''];
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += size) parts.push(value.slice(i, i + size));
  return parts;
}

export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Storage adapter shaped like supabase-js `auth.storage`. */
export function chunkedStorage(backend: KeyValueBackend, size = CHUNK_SIZE) {
  return {
    async getItem(key: string): Promise<string | null> {
      const n = await backend.getItemAsync(countKey(key));
      if (n === null) return null;
      const count = Number(n);
      if (!Number.isInteger(count) || count < 1) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await backend.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // torn write: treat as signed out rather than corrupt
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      const old = Number((await backend.getItemAsync(countKey(key))) ?? '0');
      const parts = splitValue(value, size);
      for (let i = 0; i < parts.length; i++) await backend.setItemAsync(chunkKey(key, i), parts[i]!);
      await backend.setItemAsync(countKey(key), String(parts.length));
      for (let i = parts.length; i < old; i++) await backend.deleteItemAsync(chunkKey(key, i));
    },
    async removeItem(key: string): Promise<void> {
      const old = Number((await backend.getItemAsync(countKey(key))) ?? '0');
      await backend.deleteItemAsync(countKey(key));
      for (let i = 0; i < old; i++) await backend.deleteItemAsync(chunkKey(key, i));
    },
  };
}
