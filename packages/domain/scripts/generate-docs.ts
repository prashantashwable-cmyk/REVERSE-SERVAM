/**
 * Regenerates docs/permission-matrix.md and docs/state-machines.md from the
 * domain source of truth. Run: npm run docs:generate --workspace @aiec/domain
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_MACHINES, PERMISSIONS, PERMISSION_CODES, ROLE_CODES, ROLE_ORG_KINDS, ROLE_PERMISSIONS, t } from '../src';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const header = (title: string) => `# ${title}\n\n> Generated from \`packages/domain/src\` by \`npm run docs:generate --workspace @aiec/domain\`. Do not edit by hand.\n\n`;

let pm = header('Permission matrix (Deliverable E)');
pm += 'Permissions are `resource.action`. Resource scope (own assignment, own tenant, own lead) is enforced in Postgres RLS and RPCs; see `docs/api-contracts.md`.\n\n';
pm += '## Roles and allowed organization kinds\n\n| Role | Organization kinds |\n|---|---|\n';
for (const r of ROLE_CODES) pm += `| ${t(`role.${r}`)} (\`${r}\`) | ${ROLE_ORG_KINDS[r].join(', ')} |\n`;
pm += '\n## Matrix\n\n| Permission | Description | ' + ROLE_CODES.map((r) => `\`${r}\``).join(' | ') + ' |\n';
pm += '|---|---|' + ROLE_CODES.map(() => ':-:').join('|') + '|\n';
for (const p of PERMISSION_CODES) {
  pm += `| \`${p}\` | ${PERMISSIONS[p]} | ` + ROLE_CODES.map((r) => (ROLE_PERMISSIONS[r].includes(p) ? '✓' : '')).join(' | ') + ' |\n';
}
pm += '\n## Segregation of duties (enforced in code)\n\n';
pm += '- Discount requester ≠ approver (`quotationMachine.approve`, `SELF_APPROVAL_FORBIDDEN`).\n';
pm += '- Payment claim submitter ≠ verifier; verification requires a bank / gateway match (`paymentMachine`).\n';
pm += '- Payout preparation (`finance.payout.prepare`) and release (`finance.payout.release`) are held by different roles (unit-tested).\n';
pm += '- Worker ≠ QA inspector; partner internal QA is never independent QA (`taskMachine.qa_pass`).\n';
pm += '- GPS exception reviewer ≠ the surveyor (`review_gps_exception`).\n';
pm += '- Nobody changes their own account status; the last active Owner cannot be removed, demoted or suspended.\n';
pm += '- Audit log, lead activities, duplicate decisions, business-rule versions, submitted survey revisions and evidence are append-only / immutable (database triggers).\n';
writeFileSync(join(root, 'docs', 'permission-matrix.md'), pm);

let sm = header('State machines (Deliverable D)');
sm += 'Each entity has its own machine; there is no global status. Status changes only through a named action. The `lead` and `survey` machines are also seeded into `public.state_transitions` and enforced by the database (parity is tested).\n\n';
for (const [key, m] of Object.entries(ALL_MACHINES)) {
  sm += `## ${key}\n\nStates: ${m.states.map((s) => `\`${s}\``).join(', ')}. Initial: \`${m.initial}\`. Terminal: ${m.terminal.map((s) => `\`${s}\``).join(', ') || '—'}.\n\n`;
  sm += '| From | Action | To | Permission | Reason required | Guarded | Audit event |\n|---|---|---|---|:-:|:-:|---|\n';
  for (const tr of m.transitions as readonly { from: readonly string[]; action: string; to: string; permission: string; requiresReason?: boolean; guard?: unknown; auditEvent: string }[]) {
    sm += `| ${tr.from.map((f) => `\`${f}\``).join(', ')} | \`${tr.action}\` | \`${tr.to}\` | \`${tr.permission}\` | ${tr.requiresReason ? '✓' : ''} | ${tr.guard ? '✓' : ''} | \`${tr.auditEvent}\` |\n`;
  }
  sm += '\n';
}
writeFileSync(join(root, 'docs', 'state-machines.md'), sm);
console.log('docs generated');
