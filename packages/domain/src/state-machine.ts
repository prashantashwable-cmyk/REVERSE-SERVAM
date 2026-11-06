import { DomainError, type ErrorCode } from './errors';
import type { PermissionCode } from './rbac';

/**
 * Generic, explicit state machine (spec §47). Each business entity gets its
 * OWN machine; there is no global status enum. Status may only change through
 * a named action that is validated here (client) and in the database (server).
 */
export interface GuardFailure {
  code: ErrorCode;
  /** English developer message (logs/tests). UI text comes from `messageKey`. */
  message: string;
  /** Translation key for the user-facing message. */
  messageKey?: string;
  fields?: string[];
  missing?: string[];
}

export interface TransitionDef<S extends string, A extends string, C> {
  action: A;
  from: readonly S[];
  /** Target state. Self-transitions (from === to) are allowed for edits that keep state. */
  to: S;
  /** Permission the actor must hold. Resource scoping is checked by the caller / database. */
  permission: PermissionCode;
  /** Reason text mandatory (rejections, holds, cancellations, exceptions). */
  requiresReason?: boolean;
  /** Business preconditions; return failures (empty array = pass). */
  guard?: (ctx: C) => GuardFailure[];
  /** Audit event name written by the server for this transition. */
  auditEvent: string;
}

export interface MachineDef<S extends string, A extends string, C> {
  name: string;
  states: readonly S[];
  initial: S;
  terminal: readonly S[];
  transitions: readonly TransitionDef<S, A, C>[];
}

export interface TransitionRequest<A extends string, C> {
  action: A;
  actorPermissions: ReadonlySet<PermissionCode>;
  reason?: string | null;
  context: C;
}

export type TransitionResult<S extends string> =
  | { ok: true; from: S; to: S; auditEvent: string }
  | { ok: false; error: DomainError };

export function defineMachine<S extends string, A extends string, C>(def: MachineDef<S, A, C>): MachineDef<S, A, C> {
  // Structural self-check so a malformed machine fails fast at import / test time.
  const states = new Set<string>(def.states);
  if (!states.has(def.initial)) throw new Error(`${def.name}: initial state not declared`);
  for (const t of def.terminal) if (!states.has(t)) throw new Error(`${def.name}: terminal ${t} not declared`);
  const seen = new Set<string>();
  for (const t of def.transitions) {
    if (!states.has(t.to)) throw new Error(`${def.name}: ${t.action} targets unknown state ${t.to}`);
    for (const f of t.from) {
      if (!states.has(f)) throw new Error(`${def.name}: ${t.action} from unknown state ${f}`);
      if (def.terminal.includes(f)) throw new Error(`${def.name}: ${t.action} leaves terminal state ${f}`);
      const key = `${f}::${t.action}`;
      if (seen.has(key)) throw new Error(`${def.name}: ambiguous transition ${key}`);
      seen.add(key);
    }
  }
  return def;
}

export function allowedActions<S extends string, A extends string, C>(
  machine: MachineDef<S, A, C>,
  current: S,
  actorPermissions?: ReadonlySet<PermissionCode>,
): A[] {
  return machine.transitions
    .filter((t) => t.from.includes(current) && (!actorPermissions || actorPermissions.has(t.permission)))
    .map((t) => t.action);
}

export function transition<S extends string, A extends string, C>(
  machine: MachineDef<S, A, C>,
  current: S,
  request: TransitionRequest<A, C>,
): TransitionResult<S> {
  const def = machine.transitions.find((t) => t.action === request.action && t.from.includes(current));
  if (!def) {
    return {
      ok: false,
      error: new DomainError(
        'INVALID_STATE_TRANSITION',
        `${machine.name}: action "${request.action}" is not allowed from state "${current}"`,
        { currentState: current, allowedActions: allowedActions(machine, current) },
      ),
    };
  }
  if (!request.actorPermissions.has(def.permission)) {
    return {
      ok: false,
      error: new DomainError('ACCESS_DENIED', `${machine.name}: missing permission ${def.permission}`, {
        permission: def.permission,
      }),
    };
  }
  if (def.requiresReason && !(request.reason && request.reason.trim().length >= 3)) {
    return {
      ok: false,
      error: new DomainError('REQUIRED_FIELD_MISSING', 'A reason is required for this action', { fields: ['reason'] }),
    };
  }
  const failures = def.guard ? def.guard(request.context) : [];
  if (failures.length > 0) {
    const first = failures[0]!;
    return {
      ok: false,
      error: new DomainError(first.code, first.message, {
        currentState: current,
        failures,
        fields: failures.flatMap((f) => f.fields ?? []),
        missing: failures.flatMap((f) => f.missing ?? []),
      }),
    };
  }
  return { ok: true, from: current, to: def.to, auditEvent: def.auditEvent };
}

/** Every state reachable from the initial state (used in tests to catch dead states). */
export function reachableStates<S extends string, A extends string, C>(machine: MachineDef<S, A, C>): Set<S> {
  const reached = new Set<S>([machine.initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of machine.transitions) {
      if (t.from.some((f) => reached.has(f)) && !reached.has(t.to)) {
        reached.add(t.to);
        grew = true;
      }
    }
  }
  return reached;
}
