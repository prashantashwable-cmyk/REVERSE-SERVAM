import { describe, expect, it } from 'vitest';
import { errorState, int, istLocalToIso, localError, str, uuid } from '../lib/actions';

describe('web action helpers', () => {
  it('interprets datetime-local input as IST with an explicit offset', () => {
    expect(istLocalToIso('2026-11-07T10:30')).toBe('2026-11-07T10:30:00+05:30');
    expect(istLocalToIso('2026-11-07T10:30:15')).toBe('2026-11-07T10:30:15+05:30');
    expect(Date.parse(istLocalToIso('2026-11-07T10:30')!)).toBe(Date.parse('2026-11-07T05:00:00Z'));
    expect(istLocalToIso('07/11/2026 10:30')).toBeNull();
    expect(istLocalToIso(null)).toBeNull();
  });

  it('maps RPC errors to safe, explained states', () => {
    const s = errorState({ message: 'EVIDENCE_REQUIRED', details: '{"missing":["pit","overhead"]}' });
    expect(s).toMatchObject({ status: 'error', code: 'EVIDENCE_REQUIRED', missing: ['pit', 'overhead'] });
    const raw = errorState({ message: 'column "x" does not exist', code: '42703' });
    expect(raw).toMatchObject({ status: 'error', code: 'UNKNOWN_ERROR' });
    expect(JSON.stringify(raw)).not.toContain('column');
    expect(localError('REQUIRED_FIELD_MISSING', ['scope'])).toMatchObject({ fields: ['scope'] });
  });

  it('reads form data defensively', () => {
    const f = new FormData();
    f.set('a', '  hello ');
    f.set('blank', '   ');
    f.set('n', '42');
    f.set('bad', '4x');
    f.set('id', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11');
    f.set('notid', 'abc');
    expect(str(f, 'a')).toBe('hello');
    expect(str(f, 'blank')).toBeNull();
    expect(int(f, 'n')).toBe(42);
    expect(Number.isNaN(int(f, 'bad'))).toBe(true);
    expect(int(f, 'missing')).toBeNull();
    expect(uuid(f, 'id')).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(uuid(f, 'notid')).toBeNull();
  });
});
