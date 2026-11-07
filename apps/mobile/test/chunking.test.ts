import { describe, expect, it } from 'vitest';
import { chunkKey, chunkedStorage, countKey, safeKey, splitValue } from '../src/lib/chunking';

function memoryBackend() {
  const m = new Map<string, string>();
  return {
    m,
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
}

describe('chunked secure storage adapter', () => {
  it('derives SecureStore-safe keys', () => {
    expect(safeKey('sb-abc.supabase.co-auth-token')).toBe('sb-abc.supabase.co-auth-token');
    expect(safeKey('a b/c:d')).toBe('a_b_c_d');
    expect(chunkKey('k', 2)).toBe('k.2');
    expect(countKey('k')).toBe('k.n');
  });

  it('round-trips large values and shrinks cleanly', async () => {
    const b = memoryBackend();
    const s = chunkedStorage(b, 10);
    const big = 'x'.repeat(95);
    await s.setItem('session', big);
    expect(b.m.get('session.n')).toBe('10');
    expect(await s.getItem('session')).toBe(big);
    await s.setItem('session', 'short');
    expect(await s.getItem('session')).toBe('short');
    expect([...b.m.keys()].filter((k) => k.startsWith('session.')).sort()).toEqual(['session.0', 'session.n']);
    await s.removeItem('session');
    expect(b.m.size).toBe(0);
    expect(await s.getItem('session')).toBeNull();
  });

  it('treats a torn write as signed out instead of returning corrupt data', async () => {
    const b = memoryBackend();
    const s = chunkedStorage(b, 4);
    await s.setItem('t', 'abcdefgh');
    b.m.delete('t.1');
    expect(await s.getItem('t')).toBeNull();
  });

  it('splits exactly', () => {
    expect(splitValue('abcdef', 4)).toEqual(['abcd', 'ef']);
    expect(splitValue('', 4)).toEqual(['']);
    expect(() => splitValue('a', 0)).toThrow();
  });
});
