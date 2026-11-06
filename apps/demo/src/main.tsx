import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CALL_OUTCOMES,
  DEFAULT_SURVEY_REQUIREMENTS,
  DomainError,
  LOST_REASONS,
  formatInr,
  formatPhone,
  hasMessage,
  classifyGps,
  toMillimetres,
  type LengthUnit,
  type LostReason,
} from '@aiec/domain';
import * as S from './store';
import type { DemoState, DemoUser, Lead } from './store';
import { LanguageSwitch, LocaleProvider, Rich, useT } from './locale';

/* ------------------------------ small helpers ----------------------------- */


type Route =
  | { name: 'home' }
  | { name: 'leads' }
  | { name: 'lead'; id: string }
  | { name: 'new-lead' }
  | { name: 'surveys' }
  | { name: 'survey'; id: string }
  | { name: 'audit' }
  | { name: 'inbox' }
  | { name: 'about' };

interface Ctx {
  state: DemoState;
  user: DemoUser;
  go: (r: Route) => void;
  /** Run an action against a copy of state; commit on success, show the explained error otherwise. */
  act: (fn: (s: DemoState) => void, success?: string) => boolean;
}

function Chip({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'ok' | 'warn' | 'crit' | 'gold' }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

const STATE_TONE: Record<string, 'info' | 'ok' | 'warn' | 'crit' | 'gold'> = {
  qualified: 'gold', submitted: 'gold', won: 'ok', reviewed: 'ok', lost: 'info', invalid: 'info',
  revision_requested: 'warn', reschedule_requested: 'warn', revisit_requested: 'warn', site_inaccessible: 'crit', cancelled: 'info',
};

function StateChip({ kind, state }: { kind: 'lead' | 'survey'; state: string }) {
  const { t } = useT();
  return <Chip tone={STATE_TONE[state] ?? 'info'}>{t(`${kind}.state.${state}`)}</Chip>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <label className="field">
      <span className="label">
        {label}
        {required ? <span className="req" aria-hidden="true"> *</span> : null}
        {required ? <span className="sr-only"> ({t('common.required')})</span> : null}
      </span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

/* ---------------------------------- app ----------------------------------- */

function App() {
  const { t, field, locale } = useT();
  const [state, setState] = useState<DemoState>(() => S.load(locale));
  const [userId, setUserId] = useState<string>(() => {
    try {
      return localStorage.getItem('aiec-demo-user') ?? 'u-sales1';
    } catch {
      return 'u-sales1';
    }
  });
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [toast, setToast] = useState<{ tone: 'ok' | 'crit'; title: string; body?: string } | null>(null);
  const user = S.userById(userId) ?? S.USERS[1]!;

  useEffect(() => S.save(state), [state]);
  useEffect(() => {
    try {
      localStorage.setItem('aiec-demo-user', userId);
    } catch {
      /* ignore */
    }
  }, [userId]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), toast.tone === 'ok' ? 2500 : 7000);
    return () => clearTimeout(h);
  }, [toast]);

  const go = (r: Route) => {
    setRoute(r);
    window.scrollTo(0, 0);
  };
  const act: Ctx['act'] = (fn, success) => {
    const draft = structuredClone(state);
    try {
      fn(draft);
      setState(draft);
      if (success) setToast({ tone: 'ok', title: success });
      return true;
    } catch (e) {
      const code = e instanceof DomainError ? e.code : 'UNKNOWN_ERROR';
      const d = e instanceof DomainError ? e.details : {};
      const list = [...((d.fields as string[]) ?? []), ...((d.missing as string[]) ?? [])].map(field);
      const allowed = Array.isArray(d.allowedActions) ? t('common.allowed_now', { actions: (d.allowedActions as string[]).map(field).join(', ') || t('common.none') }) : '';
      setToast({ tone: 'crit', title: t(`error.${code}.title`), body: [t(`error.${code}.next`), list.length ? `→ ${list.join(', ')}` : '', allowed].filter(Boolean).join(' ') });
      return false;
    }
  };
  const ctx: Ctx = { state, user, go, act };
  const unread = state.notices.filter((n) => n.to === user.id && !n.read).length;

  const tabs: { route: Route; label: string; show: boolean; badge?: number }[] = [
    { route: { name: 'home' }, label: t('demo.tab_home'), show: true },
    { route: { name: 'leads' }, label: t('demo.tab_leads'), show: S.perms(user).has('lead.read_all') || S.perms(user).has('lead.read_assigned') || user.role === 'partner_admin' },
    { route: { name: 'surveys' }, label: user.role === 'surveyor' ? t('demo.tab_my_surveys') : t('demo.tab_surveys'), show: user.role !== 'partner_admin' },
    { route: { name: 'audit' }, label: t('demo.tab_audit'), show: S.perms(user).has('audit.read') },
    { route: { name: 'inbox' }, label: t('demo.tab_inbox'), show: true, badge: unread },
  ];

  return (
    <div className="app">
      <div className="demo-banner" role="note">
        {t('demo.banner')} ·{' '}
        <button className="linkish" onClick={() => go({ name: 'about' })}>
          {t('demo.what_is_this')}
        </button>
      </div>
      <header className="topbar">
        <div>
          <div className="brand">AIEC</div>
          <div className="sub">{t('demo.tagline')}</div>
        </div>
        <div className="topbar-right">
        <LanguageSwitch />
        <label className="role">
          <span className="sr-only">{t('demo.viewing_as')}</span>
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              go({ name: 'home' });
            }}
          >
            {S.USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {t(`role.${u.role}`)}
              </option>
            ))}
          </select>
        </label>
        </div>
      </header>

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role={toast.tone === 'crit' ? 'alert' : 'status'} onClick={() => setToast(null)}>
          <strong>{toast.title}</strong>
          {toast.body ? <div>{toast.body}</div> : null}
        </div>
      ) : null}

      <main className="content">
        {route.name === 'home' && <Home ctx={ctx} />}
        {route.name === 'leads' && <Leads ctx={ctx} />}
        {route.name === 'new-lead' && <NewLead ctx={ctx} />}
        {route.name === 'lead' && <LeadDetail ctx={ctx} id={route.id} />}
        {route.name === 'surveys' && <Surveys ctx={ctx} />}
        {route.name === 'survey' && <SurveyDetail ctx={ctx} id={route.id} />}
        {route.name === 'audit' && <Audit ctx={ctx} />}
        {route.name === 'inbox' && <Inbox ctx={ctx} setState={setState} />}
        {route.name === 'about' && <About reset={() => { setState(S.reset(locale)); go({ name: 'home' }); setToast({ tone: 'ok', title: t('demo.reset_done') }); }} />}
      </main>

      <nav className="tabs" aria-label={t('demo.main_nav')}>
        {tabs.filter((x) => x.show).map((x) => (
          <button key={x.route.name} className={route.name === x.route.name ? 'tab active' : 'tab'} onClick={() => go(x.route)} aria-current={route.name === x.route.name ? 'page' : undefined}>
            {x.label}
            {x.badge ? <span className="badge" aria-label={t('demo.unread_count', { count: x.badge })}>{x.badge}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------------------------------- home ---------------------------------- */

function Home({ ctx }: { ctx: Ctx }) {
  const { t } = useT();
  const { state, user, go } = ctx;
  const leads = S.visibleLeads(state, user);
  const surveys = S.visibleSurveys(state, user);
  const open = (l: Lead) => ['assigned', 'contacted', 'qualified'].includes(l.status);
  const kpis: { label: string; value: number; def: string; to: Route }[] = [];
  if (S.perms(user).has('lead.read_all')) {
    kpis.push({ label: t('demo.kpi.unassigned'), value: leads.filter((l) => l.status === 'new').length, def: t('demo.kpi.unassigned_def'), to: { name: 'leads' } });
    kpis.push({ label: t('demo.kpi.qualified'), value: leads.filter((l) => l.status === 'qualified').length, def: t('demo.kpi.qualified_def'), to: { name: 'leads' } });
  }
  if (S.perms(user).has('lead.read_assigned')) {
    kpis.push({ label: t('demo.kpi.uncontacted'), value: leads.filter((l) => l.status === 'assigned').length, def: t('demo.kpi.uncontacted_def'), to: { name: 'leads' } });
    kpis.push({ label: t('demo.kpi.overdue'), value: leads.filter((l) => open(l) && l.nextActionAt && Date.parse(l.nextActionAt) < Date.now()).length, def: t('demo.kpi.overdue_def'), to: { name: 'leads' } });
  }
  if (user.role === 'surveyor') {
    kpis.push({ label: t('demo.kpi.assigned_surveys'), value: surveys.filter((v) => !['submitted', 'cancelled', 'reviewed'].includes(v.status)).length, def: t('demo.kpi.assigned_surveys_def'), to: { name: 'surveys' } });
  }
  if (S.perms(user).has('survey.read_all')) {
    kpis.push({ label: t('demo.kpi.awaiting_review'), value: surveys.filter((v) => v.status === 'submitted').length, def: t('demo.kpi.awaiting_review_def'), to: { name: 'surveys' } });
  }
  return (
    <>
      <h1>{t('demo.hello', { name: user.name.split(' ')[0] ?? user.name })}</h1>
      <p className="muted">{t(`role.${user.role}`)} · {user.org}</p>
      {user.role === 'partner_admin' ? (
        <Card title={t('demo.partner_workspace')}>
          <p>{t('demo.partner_body')}</p>
        </Card>
      ) : null}
      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.label} className="kpi" onClick={() => go(k.to)}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">{k.value}</span>
            <span className="kpi-def">{t('demo.kpi_basis', { definition: k.def })}</span>
          </button>
        ))}
      </div>
      <Card title={t('demo.try_title')}>
        <ol className="steps">
          {(['demo.try1', 'demo.try2', 'demo.try3', 'demo.try4', 'demo.try5'] as const).map((k) => (
            <li key={k}>
              <Rich text={t(k)} />
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

/* ---------------------------------- leads --------------------------------- */

function Leads({ ctx }: { ctx: Ctx }) {
  const { t } = useT();
  const { state, user, go } = ctx;
  if (!(S.perms(user).has('lead.read_all') || S.perms(user).has('lead.read_assigned'))) {
    return (
      <Card title={t('demo.no_leads_access')}>
        <p className="warn-text">{t('demo.no_leads_access_body')}</p>
      </Card>
    );
  }
  const leads = S.visibleLeads(state, user);
  return (
    <>
      <div className="row-between">
        <h1>{t('demo.tab_leads')}</h1>
        {S.perms(user).has('lead.create') ? <button className="btn" onClick={() => go({ name: 'new-lead' })}>{t('demo.new_lead_btn')}</button> : null}
      </div>
      <p className="muted">{S.perms(user).has('lead.read_all') ? t('demo.leads_all') : t('demo.leads_mine')}</p>
      {leads.length === 0 ? <p className="empty">{t('demo.no_leads')}</p> : null}
      <ul className="list">
        {leads.map((l) => {
          const late = l.nextActionAt && Date.parse(l.nextActionAt) < Date.now() && ['assigned', 'contacted', 'qualified'].includes(l.status);
          return (
            <li key={l.id}>
              <button className="item" onClick={() => go({ name: 'lead', id: l.id })}>
                <span className="item-title">{l.projectName}</span>
                <span className="mono small">{l.number}</span>
                <span className="small muted">{[l.locality, l.city].filter(Boolean).join(', ')} · {l.contactName}</span>
                <span className="row">
                  <StateChip kind="lead" state={l.status} />
                  {late ? <Chip tone="crit">{t('demo.followup_overdue')}</Chip> : null}
                  {l.score !== null ? <Chip tone="gold">{t('demo.score_chip', { score: l.score })}</Chip> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const EMPTY_LEAD: S.NewLeadInput = { contactName: '', phone: '', email: '', projectName: '', builderName: '', city: 'Pune', locality: '', lat: '', lng: '', liftRequirement: '', source: '', confirmSeparate: [], duplicateReason: '' };

function NewLead({ ctx }: { ctx: Ctx }) {
  const { t, field } = useT();
  const { state, user, go, act } = ctx;
  const [f, setF] = useState<S.NewLeadInput>(EMPTY_LEAD);
  const [showDups, setShowDups] = useState(false);
  const set = (k: keyof S.NewLeadInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dups = useMemo(() => (showDups ? S.duplicateCandidates(state, f) : []), [showDups, state, f]);
  if (!S.perms(user).has('lead.create')) return (
      <Card title={t('demo.not_allowed')}>
        <p>{t('demo.create_only_sales')}</p>
      </Card>
    );
  const submit = () => {
    let created: Lead | undefined;
    const ok = act((s) => {
      created = S.createLead(s, user, f);
    }, t('lead.created_banner'));
    if (ok && created) go({ name: 'lead', id: created.id });
    else {
      setShowDups(true);
      window.scrollTo(0, 0); // the duplicate review panel is at the top
    }
  };
  return (
    <>
      <button className="back" onClick={() => go({ name: 'leads' })}>{t('demo.back_leads')}</button>
      <h1>{t('leads.new')}</h1>
      <p className="muted">{t('demo.new_lead_intro')}</p>
      {dups.length > 0 ? (
        <Card title={t('demo.dup_title')}>
          <p className="small">{t('demo.dup_intro')}</p>
          {dups.map((d) => (
            <label key={d.id} className="dup">
              <input
                type="checkbox"
                checked={f.confirmSeparate.includes(d.id)}
                onChange={(e) => setF({ ...f, confirmSeparate: e.target.checked ? [...f.confirmSeparate, d.id] : f.confirmSeparate.filter((x) => x !== d.id) })}
              />
              <span>
                <b>{d.lead.number}</b> · {d.lead.projectName} <Chip tone={d.level === 'strong' ? 'crit' : 'warn'}>{d.level === 'strong' ? t('dup.strong') : t('dup.possible')}</Chip>
                <br />
                <span className="small muted">
                  {t('dup.matched_on', { reasons: d.reasons.map((x) => t(`dup.reason.${x}`)).join(', ') })}
                  {d.distanceM !== undefined ? ` (${t('dup.distance', { metres: Math.round(d.distanceM) })})` : ''} ·{' '}
                  {t('dup.owner', { name: S.userById(d.lead.ownerId)?.name ?? t('dup.unassigned') })}
                </span>
              </span>
            </label>
          ))}
          <Field label={t('dup.reason_label')} required>
            <textarea value={f.duplicateReason} onChange={set('duplicateReason')} rows={2} />
          </Field>
        </Card>
      ) : null}
      <Card title={t('demo.contact')}>
        <Field label={field('contact_name')} required><input value={f.contactName} onChange={set('contactName')} autoComplete="name" /></Field>
        <Field label={field('phone')} hint={t('lead_form.contact_hint')}><input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98765 43210" /></Field>
        <Field label={field('email')}><input value={f.email} onChange={set('email')} type="email" /></Field>
      </Card>
      <Card title={t('demo.site_requirement')}>
        <Field label={field('project_name')} required><input value={f.projectName} onChange={set('projectName')} /></Field>
        <Field label={field('builder_name')}><input value={f.builderName} onChange={set('builderName')} /></Field>
        <Field label={field('city')} required><input value={f.city} onChange={set('city')} list="cities" /></Field>
        <datalist id="cities"><option value="Pune" /><option value="PCMC" /></datalist>
        <Field label={field('locality')}><input value={f.locality} onChange={set('locality')} /></Field>
        <Field label={field('lift_requirement')} required hint={t('demo.requirement_hint')}><input value={f.liftRequirement} onChange={set('liftRequirement')} /></Field>
        <Field label={field('source')} required>
          <select value={f.source} onChange={set('source')}>
            <option value="" disabled>{t('common.select')}</option>
            {['website', 'phone', 'whatsapp', 'referral', 'builder_visit', 'marketing_campaign', 'existing_customer', 'manual'].map((x) => (
              <option key={x} value={x}>{t(`enum.source.${x}`)}</option>
            ))}
          </select>
        </Field>
      </Card>
      <button className="btn block" onClick={submit}>{dups.length ? t('lead_form.confirm_create') : t('lead_form.create')}</button>
    </>
  );
}

function LeadDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { t, field, dt } = useT();
  const { state, user, go, act } = ctx;
  const lead = S.visibleLeads(state, user).find((l) => l.id === id);
  const [a, setA] = useState({ type: 'call', outcome: '' as S.Activity['outcome'] | '', summary: '', next: '', noActionReason: '' });
  const [q, setQ] = useState<Record<string, string>>({});
  const [sv, setSv] = useState({ surveyorId: 'u-surv1', start: '', hours: '2' });
  const [close, setClose] = useState({ outcome: 'lost' as 'lost' | 'invalid', lostReason: '' as LostReason | '', reason: '' });
  const [assignee, setAssignee] = useState({ id: 'u-sales1', reason: '' });
  if (!lead)
    return (
      <Card title={t('demo.not_found')}>
        <p>{t('common.not_shared')}</p>
      </Card>
    );
  const isOwner = lead.ownerId === user.id;
  const open = ['assigned', 'contacted', 'qualified'].includes(lead.status);
  const activities = state.activities.filter((x) => x.leadId === id);
  const surveys = state.surveys.filter((v) => v.leadId === id);
  const qual = { ...(lead.qualification ?? {}), ...q };
  return (
    <>
      <button className="back" onClick={() => go({ name: 'leads' })}>{t('demo.back_leads')}</button>
      <h1>{lead.projectName}</h1>
      <p className="row"><span className="mono small">{lead.number}</span> <StateChip kind="lead" state={lead.status} /></p>
      <Card title={t('lead.overview')}>
        <dl className="kv">
          <dt>{field('contact_name')}</dt><dd>{lead.contactName}</dd>
          <dt>{field('phone')}</dt><dd>{lead.phone ? <a href={`tel:${lead.phone}`}>{formatPhone(lead.phone)}</a> : '—'}</dd>
          <dt>{t('lead.site')}</dt><dd>{[lead.locality, lead.city].filter(Boolean).join(', ')}</dd>
          <dt>{field('lift_requirement')}</dt><dd>{lead.liftRequirement}</dd>
          <dt>{t('demo.owner')}</dt><dd>{S.userById(lead.ownerId)?.name ?? t('demo.unassigned')}</dd>
          <dt>{field('next_action_at')}</dt><dd>{dt(lead.nextActionAt)}</dd>
          {lead.lostReason ? (<><dt>{t('demo.lost')}</dt><dd>{t(`enum.lost_reason.${lead.lostReason}`)} — {lead.closedReason}</dd></>) : null}
        </dl>
      </Card>
      {lead.scoreExplanation ? (
        <Card title={t('demo.score_title', { score: lead.score ?? '—' })}>
          <ul className="small">
            {lead.scoreExplanation.map((e) => <li key={e.key}>{e.matched ? '✓' : '—'} {field(e.key)}: {t('demo.points_short', { points: e.points })}</li>)}
          </ul>
          <p className="hint">{t('demo.score_note')}</p>
        </Card>
      ) : null}
      {surveys.length > 0 ? (
        <Card title={t('lead.surveys')}>
          {surveys.map((v) => (
            <button key={v.id} className="item" onClick={() => go({ name: 'survey', id: v.id })}>
              <span className="mono small">{v.number}</span> <StateChip kind="survey" state={v.status} /> <span className="small muted">{dt(v.start)}</span>
            </button>
          ))}
        </Card>
      ) : null}

      {isOwner && open ? (
        <Card title={t('demo.record_call')}>
          <Field label={field('outcome')}>
            <select value={a.outcome ?? ''} onChange={(e) => setA({ ...a, outcome: e.target.value as typeof a.outcome })}>
              <option value="">{t('lead_form.no_outcome')}</option>
              {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{t(`enum.call_outcome.${o}`)}</option>)}
            </select>
          </Field>
          <Field label={field('summary')} required><textarea rows={2} value={a.summary} onChange={(e) => setA({ ...a, summary: e.target.value })} /></Field>
          <Field label={field('next_follow_up_at')} hint={t('lead_form.next_follow_up_hint')}><input type="datetime-local" value={a.next} onChange={(e) => setA({ ...a, next: e.target.value })} /></Field>
          <Field label={field('no_action_reason')}><input value={a.noActionReason} onChange={(e) => setA({ ...a, noActionReason: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.recordActivity(s, user, id, { ...a, outcome: a.outcome ?? '' }), t('lead.activity_recorded')) && setA({ type: 'call', outcome: '', summary: '', next: '', noActionReason: '' })}>{t('lead.record_activity')}</button>
        </Card>
      ) : null}

      {isOwner && ['contacted', 'qualified'].includes(lead.status) ? (
        <Card title={lead.status === 'qualified' ? t('lead.update_qualification') : t('lead.qualify')}>
          <Field label={field('need')} required><input value={qual.need ?? ''} onChange={(e) => setQ({ ...qual, need: e.target.value })} /></Field>
          {([['decision_authority', ['confirmed', 'influencer', 'unknown_yet']], ['budget_readiness', ['ready', 'approval_pending', 'exploring']], ['timeline', ['within_3_months', 'within_6_months', 'later']], ['site_readiness', ['ready', 'under_construction', 'not_started']]] as const).map(([k, opts]) => (
            <Field key={k} label={field(k)} required={k === 'decision_authority' || k === 'timeline'}>
              <select value={qual[k] ?? ''} onChange={(e) => setQ({ ...qual, [k]: e.target.value })}>
                <option value="">{t('common.unknown')}</option>
                {opts.map((o) => <option key={o} value={o}>{t(`enum.qualification.${o}`)}</option>)}
              </select>
            </Field>
          ))}
          <Field label={field('next_action')} required><input value={qual.next_action ?? ''} onChange={(e) => setQ({ ...qual, next_action: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.qualify(s, user, id, Object.fromEntries(Object.entries(qual).filter(([, v]) => v))), t('lead.qualified_done'))}>{t('lead_form.save_qualification')}</button>
        </Card>
      ) : null}

      {isOwner && lead.status === 'qualified' ? (
        <Card title={t('demo.book_site_survey')}>
          <Field label={field('surveyor_id')} required>
            <select value={sv.surveyorId} onChange={(e) => setSv({ ...sv, surveyorId: e.target.value })}>
              {S.USERS.filter((u) => u.role === 'surveyor').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label={field('scheduled_start')} required><input type="datetime-local" value={sv.start} onChange={(e) => setSv({ ...sv, start: e.target.value })} /></Field>
          <Field label={field('duration_hours')} required><input inputMode="decimal" value={sv.hours} onChange={(e) => setSv({ ...sv, hours: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => { S.scheduleSurvey(s, user, id, sv.surveyorId, sv.start, Number(sv.hours) || 2, t('lead_form.default_scope')); }, t('demo.booked'))}>{t('lead_form.book_survey')}</button>
          <p className="hint">{t('demo.double_booking')}</p>
        </Card>
      ) : null}

      {isOwner && open ? (
        <Card title={t('lead.close')}>
          <Field label={field('close_outcome')}>
            <select value={close.outcome} onChange={(e) => setClose({ ...close, outcome: e.target.value as 'lost' | 'invalid' })}>
              <option value="lost">{t('enum.close_outcome.lost')}</option>
              <option value="invalid">{t('enum.close_outcome.invalid')}</option>
            </select>
          </Field>
          {close.outcome === 'lost' ? (
            <Field label={field('lost_reason')} required>
              <select value={close.lostReason} onChange={(e) => setClose({ ...close, lostReason: e.target.value as LostReason })}>
                <option value="">{t('common.select')}</option>
                {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`enum.lost_reason.${r}`)}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label={field('close_reason')} required><input value={close.reason} onChange={(e) => setClose({ ...close, reason: e.target.value })} /></Field>
          <button className="btn danger block" onClick={() => act((s) => S.closeLead(s, user, id, close.outcome, close.lostReason, close.reason), t('lead.closed_done'))}>{t('lead_form.close_lead')}</button>
        </Card>
      ) : null}

      {S.perms(user).has('lead.assign') && ['new', 'assigned', 'contacted', 'qualified', 'lost'].includes(lead.status) ? (
        <Card title={lead.status === 'new' ? t('lead.assign') : lead.status === 'lost' ? t('lead.reopen') : t('lead.reassign')}>
          <Field label={field('assignee_id')} required>
            <select value={assignee.id} onChange={(e) => setAssignee({ ...assignee, id: e.target.value })}>
              {S.USERS.filter((u) => u.role === 'sales_executive').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label={field('reason')} required={lead.status !== 'new'}><input value={assignee.reason} onChange={(e) => setAssignee({ ...assignee, reason: e.target.value })} /></Field>
          <button className="btn block" onClick={() => act((s) => S.assignLead(s, user, id, assignee.id, assignee.reason), t('demo.assigned_notified'))}>{t('demo.save')}</button>
        </Card>
      ) : null}

      {!isOwner && S.perms(user).has('lead.read_all') ? <p className="hint">{t('demo.owner_readonly')}</p> : null}

      <Card title={t('lead.history')}>
        {activities.length === 0 ? <p className="empty">{t('demo.no_activities')}</p> : null}
        {activities.map((x) => (
          <div key={x.id} className="history">
            <b>{t(`enum.activity_type.${x.type}`)}{x.outcome ? ` · ${t(`enum.call_outcome.${x.outcome}`)}` : ''}</b> <span className="small muted">{dt(x.at)}</span>
            <div>{x.summary}</div>
            <div className="small muted">{t('lead.history_next', { when: x.next ? dt(x.next) : t('lead.history_none', { reason: x.noActionReason ?? '' }) })}</div>
          </div>
        ))}
      </Card>
    </>
  );
}

/* --------------------------------- surveys -------------------------------- */

function Surveys({ ctx }: { ctx: Ctx }) {
  const { t, dt } = useT();
  const { state, user, go } = ctx;
  const list = S.visibleSurveys(state, user);
  return (
    <>
      <h1>{user.role === 'surveyor' ? t('demo.tab_my_surveys') : t('demo.tab_surveys')}</h1>
      {list.length === 0 ? <p className="empty">{t('demo.no_surveys')}</p> : null}
      <ul className="list">
        {list.map((v) => (
          <li key={v.id}>
            <button className="item" onClick={() => go({ name: 'survey', id: v.id })}>
              <span className="item-title">{v.site}</span>
              <span className="mono small">{v.number}</span>
              <span className="small muted">{dt(v.start)} · {S.userById(v.surveyorId)?.name}</span>
              <span className="row"><StateChip kind="survey" state={v.status} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Titles: survey.section.<key>; labels: field.<section>.<field> (shared with the Android app).
const SECTIONS: { key: string; fields: string[] }[] = [
  { key: 'building', fields: ['usage', 'floors', 'stops', 'construction_stage'] },
  { key: 'shaft', fields: ['access_conditions', 'obstructions'] },
  { key: 'machine_room', fields: ['availability'] },
  { key: 'electrical', fields: ['supply_type', 'phase'] },
  { key: 'logistics', fields: ['material_access_route', 'safety_hazards'] },
];
const MEASURES = ['shaft_width', 'shaft_depth', 'pit_depth', 'overhead', 'entrance_width', 'entrance_height'];

function getPosition(): Promise<{ permission: 'granted' | 'denied' | 'undetermined'; lat: number | null; lng: number | null; acc: number | null }> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ permission: 'undetermined', lat: null, lng: null, acc: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ permission: 'granted', lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ permission: e.code === e.PERMISSION_DENIED ? 'denied' : 'granted', lat: null, lng: null, acc: null }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function thumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = 160 / Math.max(img.width, img.height);
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.6));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function SurveyDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { t, field, dt } = useT();
  const { state, user, go, act } = ctx;
  const v = S.visibleSurveys(state, user).find((x) => x.id === id);
  const [reason, setReason] = useState('');
  const [gpsReason, setGpsReason] = useState('');
  const [needsReason, setNeedsReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!v)
    return (
      <Card title={t('demo.not_found')}>
        <p>{t('common.not_shared')}</p>
      </Card>
    );
  const rev = S.currentRevision(v);
  const isSurveyor = v.surveyorId === user.id && S.perms(user).has('survey.capture');
  const editing = isSurveyor && v.status === 'in_progress';
  const g = S.gate1(v);

  const updateData = (section: string, field: string, value: string) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      const data = { ...r.data, [section]: { ...(r.data[section] as Record<string, string> | undefined), [field]: value } };
      S.saveDraft(s, user, id, data, r.measurements);
    });
  const updateMeasure = (key: string, entered: string, unit: LengthUnit) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      const n = Number(entered.replace(',', '.'));
      const rest = r.measurements.filter((m) => m.key !== key);
      S.saveDraft(s, user, id, r.data, entered.trim() && Number.isFinite(n) && n > 0 ? [...rest, { key, entered: n, unit }] : rest);
    });
  const docReason = (doc: string, text: string) =>
    act((s) => {
      const sv = s.surveys.find((x) => x.id === id)!;
      const r = S.currentRevision(sv);
      S.saveDraft(s, user, id, { ...r.data, documents_unavailable: { ...(r.data.documents_unavailable ?? {}), [doc]: text } }, r.measurements);
    });
  const capture = async (category: string, file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    const [thumb, pos] = await Promise.all([thumbnail(file), getPosition()]);
    setBusy(false);
    const gps: S.Evidence['gps'] = pos.lat !== null ? { status: 'verified', accuracyM: Math.round(pos.acc ?? 0) } : { status: pos.permission === 'denied' ? 'permission_denied' : 'unavailable', accuracyM: null };
    act((s) => S.addEvidence(s, user, id, category, thumb, gps), t('demo.photo_added', { category: field(category) }));
  };

  return (
    <>
      <button className="back" onClick={() => go({ name: 'surveys' })}>{t('demo.back_surveys')}</button>
      <h1>{v.site}</h1>
      <p className="row"><span className="mono small">{v.number}</span> <StateChip kind="survey" state={v.status} /> {rev.no > 1 ? <Chip tone="warn">{t('demo.revision_chip', { no: rev.no })}</Chip> : null}</p>
      <Card title={t('mobile.assignment')}>
        <dl className="kv">
          <dt>{t('demo.when')}</dt><dd>{dt(v.start)} → {dt(v.end)}</dd>
          <dt>{field('scope')}</dt><dd>{v.scope}</dd>
          <dt>{t('survey.site_contact')}</dt><dd>{v.contactName}{v.contactPhone ? <> · <a href={`tel:${v.contactPhone}`}>{formatPhone(v.contactPhone)}</a></> : null}</dd>
          <dt>{field('surveyor_id')}</dt><dd>{S.userById(v.surveyorId)?.name}</dd>
          <dt>{t('survey.checkin')}</dt>
          <dd>{v.checkedInAt ? `${dt(v.checkedInAt)} · ${v.gpsStatus === 'verified' ? t('surveys.gps_verified') : `${t(`enum.gps.${v.gpsStatus ?? 'unavailable'}`)} — ${v.gpsReason}`}` : t('demo.not_yet')}</dd>
        </dl>
        {v.statusReason ? <p className="warn-text">{t('mobile.note', { text: v.statusReason })}</p> : null}
      </Card>

      {isSurveyor && v.status === 'scheduled' ? (
        <Card title={t('mobile.accept_assignment')}>
          <button className="btn block" onClick={() => act((s) => S.surveyAction(s, user, id, 'accept'), t('demo.accepted'))}>{t('mobile.accept')}</button>
          <Field label={t('demo.reason_reschedule')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn secondary block" onClick={() => act((s) => S.surveyAction(s, user, id, 'request_reschedule', reason), t('demo.reschedule_requested'))}>{t('mobile.request_reschedule')}</button>
        </Card>
      ) : null}

      {isSurveyor && v.status === 'accepted' ? (
        <Card title={t('mobile.site_checkin')}>
          <p className="small">{t('demo.checkin_intro')}</p>
          {needsReason ? (
            <>
              <p className="warn-text">{t('demo.location_not_verified', { status: t(`enum.gps.${needsReason}`) })}</p>
              <Field label={t('mobile.gps_reason')} required><input value={gpsReason} onChange={(e) => setGpsReason(e.target.value)} /></Field>
            </>
          ) : null}
          <button
            className="btn block"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const pos = await getPosition();
              setBusy(false);
              const ok = act((s) => {
                S.checkIn(s, user, id, pos, gpsReason);
              }, t('demo.checked_in'));
              const gps = classifyGps({ permission: pos.permission, latitude: pos.lat, longitude: pos.lng, accuracyM: pos.acc });
              setNeedsReason(!ok && gps !== 'verified' ? gps : null);
            }}
          >
            {busy ? t('demo.getting_location') : t('mobile.check_in_now')}
          </button>
          <Field label={t('demo.reason_inaccessible')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn danger block" onClick={() => act((s) => S.surveyAction(s, user, id, 'report_inaccessible', reason), t('demo.reported'))}>{t('mobile.report_inaccessible')}</button>
        </Card>
      ) : null}

      {isSurveyor && v.status === 'revision_requested' ? (
        <Card title={t('mobile.revision_requested')}>
          <p>{v.statusReason}</p>
          <button className="btn block" onClick={() => act((s) => S.surveyAction(s, user, id, 'start_revision'), t('demo.revision_started'))}>{t('mobile.start_revision')}</button>
        </Card>
      ) : null}

      {editing ? (
        <>
          {SECTIONS.map((sec) => (
            <Card key={sec.key} title={t(`survey.section.${sec.key}`)}>
              {sec.fields.map((k) => (
                <Field key={k} label={t(`field.${sec.key}.${k}`)} required={DEFAULT_SURVEY_REQUIREMENTS.required_fields.includes(`${sec.key}.${k}`)}>
                  <input
                    defaultValue={(rev.data[sec.key] as Record<string, string> | undefined)?.[k] ?? ''}
                    onBlur={(e) => updateData(sec.key, k, e.target.value)}
                    inputMode={k === 'floors' || k === 'stops' ? 'numeric' : undefined}
                    placeholder={hasMessage(`hint.${sec.key}.${k}`) ? t(`hint.${sec.key}.${k}`) : t('mobile.unknown_placeholder')}
                  />
                </Field>
              ))}
            </Card>
          ))}
          <Card title={t('mobile.measurements')}>
            <p className="hint">{t('mobile.measurements_intro')}</p>
            {MEASURES.map((key) => {
              const m = rev.measurements.find((x) => x.key === key);
              const unit = m?.unit ?? 'mm';
              return (
                <div key={key} className="measure">
                  <Field label={`${t(`measure.${key}`)} (${unit})`} required>
                    <input inputMode="decimal" defaultValue={m ? String(m.entered) : ''} onBlur={(e) => updateMeasure(key, e.target.value, unit)} />
                  </Field>
                  <div className="units" role="radiogroup" aria-label={t('mobile.unit_for', { label: t(`measure.${key}`) })}>
                    {(['mm', 'cm', 'm'] as const).map((u) => (
                      <button key={u} role="radio" aria-checked={unit === u} className={unit === u ? 'unit on' : 'unit'} onClick={() => m && updateMeasure(key, String(m.entered), u)} disabled={!m}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
          <Card title={t('mobile.photo_evidence')}>
            <p className="hint">{t('demo.evidence_hint')}</p>
            {[...DEFAULT_SURVEY_REQUIREMENTS.required_evidence, 'machine_room', 'other'].map((cat) => {
              const n = v.evidence.filter((e) => e.category === cat && !e.superseded).length;
              return (
                <div key={cat} className="evidence-row">
                  <span>
                    {t(`enum.evidence.${cat}`)} {DEFAULT_SURVEY_REQUIREMENTS.required_evidence.includes(cat) ? <span className="req">*</span> : null}{' '}
                    <span className="small muted">· {t('demo.photo_count', { count: n })}</span>
                  </span>
                  <label className={`btn ${n ? 'secondary' : ''} small-btn`}>
                    {n ? t('demo.add') : t('demo.capture')}
                    <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void capture(cat, e.target.files?.[0])} />
                  </label>
                </div>
              );
            })}
          </Card>
          <Card title={t('mobile.documents')}>
            <p className="hint">{t('demo.docs_hint')}</p>
            {DEFAULT_SURVEY_REQUIREMENTS.required_documents.map((doc) => {
              const n = v.evidence.filter((e) => e.category === doc).length;
              return (
                <div key={doc} className="doc">
                  <div className="evidence-row">
                    <span>
                      {t(`enum.evidence.${doc}`)} <span className="small muted">· {n ? t('demo.attached') : t('demo.missing')}</span>
                    </span>
                    <label className="btn secondary small-btn">
                      {t('demo.photo')}
                      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void capture(doc, e.target.files?.[0])} />
                    </label>
                  </div>
                  {n === 0 ? <input placeholder={t('mobile.doc_unavailable')} defaultValue={rev.data.documents_unavailable?.[doc] ?? ''} onBlur={(e) => docReason(doc, e.target.value)} /> : null}
                </div>
              );
            })}
          </Card>
          <Card title={t('mobile.review_submit')}>
            <p className="small">{t('mobile.complete_count', { done: g.completion.done, total: g.completion.total })}</p>
            {g.failures.map((f) => (
              <p key={f.message} className="crit-text">
                ✗ {f.messageKey ? t(f.messageKey) : t(`error.${f.code}.title`)}: {[...(f.fields ?? []), ...(f.missing ?? [])].map((x) => field(x)).join(', ')}
              </p>
            ))}
            {g.warnings.map((w) => (
              <p key={w.key} className="warn-text">
                ⚠ {t(w.messageKey, { ...w.params, measure: t(`measure.${w.key}`) })}
              </p>
            ))}
            <button className="btn block" disabled={g.failures.length > 0} onClick={() => act((s) => S.submitSurvey(s, user, id), t('demo.submitted'))}>{t('mobile.submit_survey')}</button>
            <Field label={t('demo.reason_revisit')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className="btn secondary block" onClick={() => act((s) => S.surveyAction(s, user, id, 'request_revisit', reason), t('demo.revisit_requested'))}>{t('mobile.request_revisit')}</button>
          </Card>
        </>
      ) : null}

      {!editing ? (
        <Card title={t('survey.revision_title', { no: rev.no, status: t(`enum.revision_status.${rev.status}`) })}>
          {rev.reason ? <p className="warn-text">{t('survey.revision_reason', { reason: rev.reason })}</p> : null}
          {rev.measurements.length === 0 ? <p className="empty">{t('survey.no_measurements')}</p> : (
            <table className="tbl">
              <thead><tr><th>{t('survey.col_measurement')}</th><th>{t('demo.col_mm')}</th><th>{t('demo.col_entered')}</th></tr></thead>
              <tbody>
                {rev.measurements.map((m) => {
                  let mm = '—';
                  try {
                    mm = String(toMillimetres(m.entered, m.unit));
                  } catch {
                    /* invalid entry: shown as — */
                  }
                  return <tr key={m.key}><td>{field(`measurement.${m.key}`)}</td><td className="mono">{mm}</td><td className="mono">{m.entered} {m.unit}</td></tr>;
                })}
              </tbody>
            </table>
          )}
          {v.evidence.length ? (
            <div className="thumbs">
              {v.evidence.map((e) => (
                <figure key={e.id}>
                  {e.thumb ? <img src={e.thumb} alt={t(`enum.evidence.${e.category}`)} /> : <div className="nothumb">{t(`enum.evidence.${e.category}`)}</div>}
                  <figcaption>
                    {t(`enum.evidence.${e.category}`)}
                    <br />
                    {e.gps.status === 'verified' ? t('demo.gps_acc', { metres: e.gps.accuracyM ?? 0 }) : t(`enum.gps.${e.gps.status}`)}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      {S.perms(user).has('survey.review') && ['submitted', 'under_review'].includes(v.status) ? (
        <Card title={t('demo.technical_review')}>
          <Field label={t('survey_form.return_reason')} required><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn block" onClick={() => act((s) => S.requestRevision(s, user, id, reason), t('survey.returned_done'))}>{t('survey_form.return')}</button>
          <p className="hint">{t('demo.review_note')}</p>
        </Card>
      ) : null}
    </>
  );
}

/* ------------------------------ audit & inbox ----------------------------- */

function Audit({ ctx }: { ctx: Ctx }) {
  const { t, dt } = useT();
  const { state, user } = ctx;
  if (!S.perms(user).has('audit.read'))
    return (
      <Card title={t('demo.no_access')}>
        <p>{t('demo.audit_owner_only')}</p>
      </Card>
    );
  return (
    <>
      <h1>{t('audit.title')}</h1>
      <p className="muted">{t('demo.audit_intro')}</p>
      <ul className="list">
        {state.audit.map((x, i) => (
          <li key={i} className="audit">
            <b>{hasMessage(`audit.action.${x.action}`) ? t(`audit.action.${x.action}`) : x.action}</b> · <span className="mono small">{x.entity}</span>
            <div className="small muted">
              {dt(x.at)} · {x.actor ? t('demo.actor_as', { actor: x.actor, role: t(`role.${x.role}`) }) : t('audit.system')}
            </div>
            {x.reasonKey || x.reason ? (
              <div className="small">
                {t('audit.reason', { reason: [x.reasonKey ? t(x.reasonKey, x.reasonParams) : '', x.reason ?? ''].filter(Boolean).join(': ') })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function Inbox({ ctx, setState }: { ctx: Ctx; setState: (s: DemoState) => void }) {
  const { t, dt } = useT();
  const { state, user } = ctx;
  const mine = state.notices.filter((n) => n.to === user.id);
  return (
    <>
      <h1>{t('notifications.title')}</h1>
      {mine.length === 0 ? <p className="empty">{t('demo.all_caught_up')}</p> : null}
      <ul className="list">
        {mine.map((n) => (
          <li key={n.id} className={n.read ? 'notice read' : 'notice'}>
            <div>
              {n.read ? null : <span className="sr-only">{t('notifications.unread')}</span>}
              {t(n.key, { ...n.params, ...(n.params.action ? { action: t(`action.${n.params.action}`) } : {}) })}
            </div>
            <div className="small muted">{dt(n.at)}</div>
            {!n.read ? (
              <button className="linkish" onClick={() => setState({ ...state, notices: state.notices.map((x) => (x.id === n.id ? { ...x, read: true } : x)) })}>{t('notifications.mark_read')}</button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function About({ reset }: { reset: () => void }) {
  const { t } = useT();
  return (
    <>
      <h1>{t('demo.about_title')}</h1>
      <Card>
        <p>
          <Rich text={t('demo.about1')} />
        </p>
        <p>{t('demo.about2', { amount: formatInr(1638878_40n) })}</p>
        <p className="small muted">{t('demo.about3')}</p>
      </Card>
      <button className="btn danger block" onClick={reset}>
        {t('demo.reset')}
      </button>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
