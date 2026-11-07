// TEST-ONLY local stand-in for the Supabase HTTP API (auth + PostgREST subset +
// storage signing). Every data request runs in Postgres as role `authenticated`
// with the caller's JWT claims, so RLS, grants and RPC checks are the real ones.
// OTP: any registered phone, code 123456. Not part of the product.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = 54400;
const SECRET = 'local-e2e-secret';
const pool = new pg.Pool({ connectionString: process.env.AIEC_E2E_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/aiec_test', max: 8 });

const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(sub, phone) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ sub, phone, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 8 * 3600 }));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = (token ?? '').split('.');
  if (!s) return null;
  const good = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (good !== s) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const userJson = (id, phone) => ({ id, aud: 'authenticated', role: 'authenticated', phone, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
function session(id, phone) {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: sign(id, phone), token_type: 'bearer', expires_in: 28800, expires_at: now + 28800, refresh_token: `r-${id}`, user: userJson(id, phone) };
}

async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('bad identifier'), { status: 400 });
  return `"${s}"`;
};

// --- select parsing with embeds: "a, b, sites(name, city), rel(*)" ---
function parseSelect(str) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((item) => {
    const m = /^([a-z_]+)\((.*)\)$/s.exec(item);
    return m ? { embed: m[1], inner: parseSelect(m[2]) } : { col: item };
  });
}

async function fkBetween(c, parent, child) {
  // many-to-one: parent has FK to child
  const q = `select a.attname as col, af.attname as ref from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
    where k.contype = 'f' and k.conrelid = $1::regclass and k.confrelid = $2::regclass limit 1`;
  const m2o = (await c.query(q, [`public.${parent}`, `public.${child}`])).rows[0];
  if (m2o) return { kind: 'one', ...m2o };
  const o2m = (await c.query(q, [`public.${child}`, `public.${parent}`])).rows[0];
  if (o2m) return { kind: 'many', col: o2m.ref, ref: o2m.col };
  throw Object.assign(new Error(`no relationship ${parent}->${child}`), { status: 400 });
}

async function selectSql(c, table, items, alias) {
  const parts = [];
  for (const it of items) {
    if (it.col) {
      parts.push(it.col === '*' ? `to_jsonb(${alias}.*)` : `jsonb_build_object('${it.col}', ${alias}.${ident(it.col)})`);
    } else {
      const rel = await fkBetween(c, table, it.embed);
      const sub = `e_${it.embed}`;
      const inner = await selectSql(c, it.embed, it.inner, sub);
      if (rel.kind === 'one') {
        parts.push(`jsonb_build_object('${it.embed}', (select ${inner} from public.${ident(it.embed)} ${sub} where ${sub}.${ident(rel.ref)} = ${alias}.${ident(rel.col)}))`);
      } else {
        parts.push(`jsonb_build_object('${it.embed}', coalesce((select jsonb_agg(${inner}) from public.${ident(it.embed)} ${sub} where ${sub}.${ident(rel.ref)} = ${alias}.${ident(rel.col)}), '[]'::jsonb))`);
      }
    }
  }
  return parts.length ? parts.join(' || ') : `'{}'::jsonb`;
}

function unquote(v) {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}
function filterSql(col, expr, params) {
  const m = /^(not\.)?(eq|neq|lt|lte|gt|gte|is|in|ilike|like)\.(.*)$/s.exec(expr);
  if (!m) throw Object.assign(new Error(`unsupported filter ${expr}`), { status: 400 });
  const [, not, op, raw] = m;
  let sql;
  const ops = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', ilike: 'ilike', like: 'like' };
  if (op === 'is') sql = `${ident(col)} is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
  else if (op === 'in') {
    const vals = raw.replace(/^\(|\)$/g, '').split(',').map((v) => unquote(v.trim()));
    params.push(vals);
    sql = `${ident(col)}::text = any($${params.length}::text[])`;
  } else {
    const v = unquote(raw).replace(/\*/g, '%');
    params.push(v);
    sql = op === 'ilike' || op === 'like' ? `${ident(col)}::text ${ops[op]} $${params.length}` : `${ident(col)} ${ops[op]} $${params.length}`;
  }
  return not ? `not (${sql})` : sql;
}

async function handleRest(req, res, url, claims, body) {
  const path = url.pathname.replace('/rest/v1/', '');
  if (path.startsWith('rpc/')) {
    const fn = path.slice(4);
    const args = body ? JSON.parse(body) : {};
    const keys = Object.keys(args);
    keys.forEach(ident);
    const vals = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    const sql = `select public.${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const r = await asUser(claims, (c) => c.query(sql, vals));
    return send(res, 200, r.rows[0].r);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { message: 'gateway is read-only for tables (writes go through RPCs)' });
  const table = path;
  const params = [];
  const where = [];
  let order = '';
  let limit = '';
  let offset = '';
  for (const [k, v] of url.searchParams) {
    if (k === 'select' || k === 'columns') continue;
    if (k === 'order') {
      order = 'order by ' + v.split(',').map((o) => { const [c, dir, nulls] = o.split('.'); return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ');
    } else if (k === 'limit') limit = `limit ${Number.parseInt(v, 10)}`;
    else if (k === 'offset') offset = `offset ${Number.parseInt(v, 10)}`;
    else if (k === 'or') {
      const inner = v.replace(/^\(|\)$/g, '');
      const conds = [];
      let depth = 0, cur = '', q = false;
      for (const ch of inner) { if (ch === '"') q = !q; if (!q && ch === '(') depth++; if (!q && ch === ')') depth--; if (ch === ',' && depth === 0 && !q) { conds.push(cur); cur = ''; } else cur += ch; }
      if (cur) conds.push(cur);
      where.push('(' + conds.map((cnd) => { const i = cnd.indexOf('.'); return filterSql(cnd.slice(0, i), cnd.slice(i + 1), params); }).join(' or ') + ')');
    } else where.push(filterSql(k, v, params));
  }
  const out = await asUser(claims, async (c) => {
    const proj = await selectSql(c, table, parseSelect(url.searchParams.get('select') ?? '*'), 't');
    const w = where.length ? `where ${where.join(' and ')}` : '';
    const rows = (await c.query(`select ${proj} as j from public.${ident(table)} t ${w} ${order} ${limit} ${offset}`, params)).rows.map((r) => r.j);
    let total = null;
    if (/count=exact/.test(req.headers.prefer ?? '')) total = Number((await c.query(`select count(*) from public.${ident(table)} t ${w}`, params)).rows[0].count);
    return { rows, total };
  });
  const start = Number(url.searchParams.get('offset') ?? 0);
  const headers = { 'content-range': `${out.rows.length ? `${start}-${start + out.rows.length - 1}` : '*'}/${out.total ?? '*'}` };
  return send(res, 200, req.method === 'HEAD' ? undefined : out.rows, headers);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    const t0 = Date.now(); const tag = `${req.method} ${req.url.slice(0, 90)}`;
    console.log('START', tag);
    res.on('finish', () => console.log('END', Date.now() - t0, 'ms', res.statusCode, tag));
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const body = raw.toString('utf8');
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (url.pathname === '/auth/v1/otp') return send(res, 200, {});
      if (url.pathname === '/auth/v1/verify') {
        const { phone, token } = JSON.parse(body);
        const digits = String(phone).replace(/\D/g, '');
        const u = (await pool.query('select id, phone from auth.users where phone = $1', [digits])).rows[0];
        if (!u || token !== '123456') return send(res, 400, { error: 'invalid_grant', error_description: 'Token has expired or is invalid', code: 'otp_expired' });
        return send(res, 200, session(u.id, u.phone));
      }
      if (url.pathname === '/auth/v1/user') return claims ? send(res, 200, userJson(claims.sub, claims.phone)) : send(res, 401, { code: 401, msg: 'invalid JWT' });
      if (url.pathname === '/auth/v1/logout') return send(res, 204);
      if (url.pathname === '/auth/v1/token') return send(res, 400, { error: 'invalid_grant' });
      if (req.method === 'POST' && url.pathname.startsWith('/storage/v1/object/') && !url.pathname.startsWith('/storage/v1/object/sign/')) {
        // Upload: record the object as the caller so storage RLS decides (bytes are not kept).
        if (!claims) return send(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'JWT expired' });
        const [bucket, ...rest] = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length)).split('/');
        const name = rest.join('/');
        try {
          await asUser(claims, (c) => c.query('insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)',
            [bucket, name, claims.sub, { size: raw.length, mimetype: req.headers['content-type'] ?? 'application/octet-stream' }]));
        } catch (e) {
          return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: e.message });
        }
        return send(res, 200, { Key: `${bucket}/${name}`, Id: name });
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/')) {
        const { paths } = JSON.parse(body);
        return send(res, 200, paths.map((p) => ({ path: p, signedURL: `/object/sign/evidence/${p}?token=e2e`, error: null })));
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired' });
        return await handleRest(req, res, url, claims, body);
      }
      return send(res, 404, { message: 'not found' });
    } catch (e) {
      return send(res, e.status ?? 400, { code: e.code ?? 'PGRST', message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
    }
  })
  .listen(PORT, () => console.log(`e2e gateway on ${PORT}`));
