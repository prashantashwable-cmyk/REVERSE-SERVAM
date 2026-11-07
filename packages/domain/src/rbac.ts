/**
 * Role and permission model (spec §3, §46).
 *
 * This file is the single source of truth for the role → permission matrix.
 * The database seed in supabase/migrations must match it exactly; the DB test
 * suite (supabase/tests) asserts that.
 */

export const ORGANIZATION_KINDS = ['aiec', 'partner', 'customer', 'supplier', 'qa_agency'] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const ROLE_CODES = [
  'owner',
  'operations_manager',
  'sales_executive',
  'surveyor',
  'technical_manager',
  'accounts_finance',
  'procurement_manager',
  'partner_admin',
  'partner_supervisor',
  'technician',
  'qa_inspector',
  'customer',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Which organization kinds a role may be granted in. */
export const ROLE_ORG_KINDS: Record<RoleCode, readonly OrganizationKind[]> = {
  owner: ['aiec'],
  operations_manager: ['aiec'],
  sales_executive: ['aiec'],
  surveyor: ['aiec'],
  technical_manager: ['aiec'],
  accounts_finance: ['aiec'],
  procurement_manager: ['aiec'],
  partner_admin: ['partner'],
  partner_supervisor: ['partner'],
  technician: ['partner'],
  qa_inspector: ['aiec', 'qa_agency'],
  customer: ['customer'],
};

export const PERMISSIONS = {
  // Identity & administration
  'user.read': 'View user profiles within permitted organizations',
  'user.manage': 'Activate, suspend and verify users',
  'role.assign': 'Grant and revoke role assignments',
  'org.manage': 'Create and manage organizations',
  'rules.manage': 'Change business rules and approval limits',
  'audit.read': 'Read the audit log',
  'approval.exception.decide': 'Decide authorized workflow exceptions',
  // Leads
  'lead.create': 'Create leads',
  'lead.read_all': 'Read all leads in the organization',
  'lead.read_assigned': 'Read leads assigned to me',
  'lead.update_assigned': 'Update leads assigned to me',
  'lead.assign': 'Assign / reassign / reopen leads',
  'lead.activity.record': 'Record lead activities and follow-ups',
  'lead.qualify': 'Qualify leads',
  'lead.close': 'Close leads as lost or invalid',
  'lead.merge': 'Decide duplicate merges',
  // Survey
  'survey.schedule': 'Book, reschedule and cancel surveys',
  'survey.read_all': 'Read all surveys',
  'survey.read_assigned': 'Read surveys assigned to me',
  'survey.capture': 'Perform assigned surveys (check-in, capture, submit)',
  'survey.review': 'Review submitted surveys and request revisions',
  'survey.gps_exception.review': 'Review GPS / check-in exceptions',
  // Technical
  'technical.review': 'Record technical feasibility decisions',
  'technical.configuration.approve': 'Approve lift configuration revisions',
  'technical.drawing.approve': 'Approve drawing / BOM revisions',
  'technical.change.approve': 'Approve technical change and substitution requests',
  // Commercial
  'quotation.create': 'Prepare quotation drafts',
  'quotation.issue': 'Issue approved quotation revisions to customers',
  'quotation.discount.approve': 'Approve discounts beyond sales authority',
  'order.convert': 'Convert an accepted quotation to an order',
  // Projects & operations
  'project.read_all': 'Read all projects',
  'project.plan': 'Plan projects, readiness and schedules',
  'partner.assign': 'Assign partner companies to projects',
  'partner.verify': 'Verify partner companies and compliance documents',
  // Finance
  'finance.payment.verify': 'Verify customer payment claims',
  'finance.payout.prepare': 'Prepare partner / supplier payouts',
  'finance.payout.release': 'Approve and release payouts',
  'finance.ledger.read': 'Read financial ledgers',
  'finance.expense.approve': 'Approve expenses',
  // Procurement
  'procurement.request.create': 'Create purchase requests against approved BOM',
  'procurement.po.create': 'Create purchase orders',
  'procurement.po.approve': 'Approve purchase orders',
  'procurement.grn.record': 'Record goods receipts',
  // Partner tenant
  'partner.org.manage': 'Manage own partner company profile',
  'partner.project.read': 'Read projects assigned to own partner company',
  'partner.team.manage': 'Manage own partner workforce',
  'partner.task.assign': 'Assign partner tasks to own team members',
  'partner.daily_report.submit': 'Submit daily work reports',
  'partner.claim.submit': 'Submit partner milestone payment claims',
  // Technician
  'task.execute': 'Execute assigned tasks and capture evidence',
  // QA
  'qa.inspection.decide': 'Decide assigned inspections',
  'qa.defect.manage': 'Create, verify and close defects',
  // Customer
  'customer.project.read': 'Read own projects',
  'customer.approval.decide': 'Approve exact document / quotation revisions',
} as const satisfies Record<string, string>;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  owner: [
    'user.read',
    'user.manage',
    'role.assign',
    'org.manage',
    'rules.manage',
    'audit.read',
    'approval.exception.decide',
    'lead.read_all',
    'lead.assign',
    'lead.merge',
    'survey.read_all',
    'project.read_all',
    'quotation.discount.approve',
    'partner.verify',
    'finance.ledger.read',
    'finance.payout.release',
    'procurement.po.approve',
  ],
  operations_manager: [
    'user.read',
    'survey.read_all',
    'project.read_all',
    'project.plan',
    'partner.assign',
    'procurement.po.approve',
  ],
  sales_executive: [
    'lead.create',
    'lead.read_assigned',
    'lead.update_assigned',
    'lead.activity.record',
    'lead.qualify',
    'lead.close',
    'survey.schedule',
    'quotation.create',
    'quotation.issue',
    'order.convert',
  ],
  surveyor: ['survey.read_assigned', 'survey.capture'],
  technical_manager: [
    'survey.read_all',
    'survey.review',
    'survey.gps_exception.review',
    'technical.review',
    'technical.configuration.approve',
    'technical.drawing.approve',
    'technical.change.approve',
  ],
  accounts_finance: [
    'finance.payment.verify',
    'finance.payout.prepare',
    'finance.ledger.read',
    'finance.expense.approve',
  ],
  procurement_manager: ['procurement.request.create', 'procurement.po.create', 'procurement.grn.record'],
  partner_admin: [
    'user.read',
    'partner.org.manage',
    'partner.project.read',
    'partner.team.manage',
    'partner.task.assign',
    'partner.daily_report.submit',
    'partner.claim.submit',
  ],
  partner_supervisor: ['partner.project.read', 'partner.task.assign', 'partner.daily_report.submit'],
  technician: ['task.execute'],
  qa_inspector: ['qa.inspection.decide', 'qa.defect.manage'],
  customer: ['customer.project.read', 'customer.approval.decide'],
};

export interface RoleAssignment {
  organizationId: string;
  organizationKind: OrganizationKind;
  role: RoleCode;
}

export interface ActorContext {
  userId: string;
  /** Account status from user_profiles. Only `active` users may act. */
  accountStatus: 'pending_verification' | 'active' | 'suspended';
  assignments: readonly RoleAssignment[];
}

export function permissionsForRole(role: RoleCode): ReadonlySet<PermissionCode> {
  return new Set(ROLE_PERMISSIONS[role]);
}

/** Is the role allowed to be granted inside an organization of this kind? */
export function roleAllowedInOrganization(role: RoleCode, kind: OrganizationKind): boolean {
  return ROLE_ORG_KINDS[role].includes(kind);
}

/**
 * Does the actor hold `permission` in `organizationId` (or anywhere when
 * organizationId is omitted)? Suspended / unverified accounts hold nothing.
 * NOTE: this is for UI rendering only; the database enforces the same rule.
 */
export function hasPermission(actor: ActorContext, permission: PermissionCode, organizationId?: string): boolean {
  if (actor.accountStatus !== 'active') return false;
  return actor.assignments.some(
    (a) =>
      (organizationId === undefined || a.organizationId === organizationId) &&
      roleAllowedInOrganization(a.role, a.organizationKind) &&
      ROLE_PERMISSIONS[a.role].includes(permission),
  );
}

export function effectivePermissions(actor: ActorContext): Set<PermissionCode> {
  const out = new Set<PermissionCode>();
  if (actor.accountStatus !== 'active') return out;
  for (const a of actor.assignments) {
    if (!roleAllowedInOrganization(a.role, a.organizationKind)) continue;
    for (const p of ROLE_PERMISSIONS[a.role]) out.add(p);
  }
  return out;
}

/** Segregation-of-duties rules (spec §46.2). */
export const SEGREGATION_RULES = {
  /** A discount / exception requester can never approve their own request. */
  noSelfApproval: (requesterId: string, approverId: string) => requesterId !== approverId,
  /** Payment claim submitter cannot verify it. */
  noSelfVerification: (submittedBy: string, verifierId: string) => submittedBy !== verifierId,
  /** Payout preparer cannot release the same payout. */
  preparerIsNotReleaser: (preparedBy: string, releaserId: string) => preparedBy !== releaserId,
  /** Technician who submitted work cannot decide the QA inspection of it. */
  workerIsNotInspector: (submittedBy: string, inspectorId: string) => submittedBy !== inspectorId,
} as const;

/** Partner internal QA is never AIEC independent QA (Gate 10). */
export function isIndependentQaActor(actor: ActorContext, aiecOrganizationId: string): boolean {
  return actor.assignments.some(
    (a) =>
      a.role === 'qa_inspector' &&
      (a.organizationKind === 'qa_agency' || a.organizationId === aiecOrganizationId) &&
      a.organizationKind !== 'partner',
  ) && actor.accountStatus === 'active';
}
