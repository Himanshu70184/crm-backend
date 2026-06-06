/**
 * Shared permission constants — single source of truth for both
 * the Role model and the permission middleware.
 */

const MODULES = [
  { key: 'employees',     label: 'Employees',        group: 'HR' },
  { key: 'attendance',    label: 'Attendance',        group: 'HR' },
  { key: 'leave',         label: 'Leave Management',  group: 'HR' },
  { key: 'payroll',       label: 'Payroll',           group: 'HR' },
  { key: 'recruitment',   label: 'Recruitment',       group: 'HR' },
  { key: 'performance',   label: 'Performance',       group: 'HR' },
  { key: 'projects',      label: 'Projects',          group: 'Operations' },
  { key: 'tasks',         label: 'Tasks',             group: 'Operations' },
  { key: 'teams',         label: 'Teams',             group: 'Operations' },
  { key: 'clients',       label: 'Clients',           group: 'Operations' },
  { key: 'meetings',      label: 'Meetings',          group: 'Operations' },
  { key: 'tickets',       label: 'Tickets',           group: 'Operations' },
  { key: 'reports',       label: 'Reports',           group: 'Analytics' },
  { key: 'assets',        label: 'Assets',            group: 'Resources' },
  { key: 'documents',     label: 'Documents',         group: 'Resources' },
  { key: 'announcements', label: 'Announcements',     group: 'Communication' },
  { key: 'settings',      label: 'Settings',          group: 'Administration' },
  { key: 'chat',          label: 'Chat',              group: 'Communication' },
];

const MODULE_KEYS = MODULES.map((m) => m.key);

const ACTIONS = [
  { key: 'create',          label: 'Create' },
  { key: 'read',            label: 'Read' },
  { key: 'update',          label: 'Update' },
  { key: 'delete',          label: 'Delete' },
  { key: 'approve',         label: 'Approve' },
  { key: 'assign',          label: 'Assign' },
  { key: 'export',          label: 'Export' },
  { key: 'import',          label: 'Import' },
  { key: 'manage_settings', label: 'Manage Settings' },
];

const ACTION_KEYS = ACTIONS.map((a) => a.key);

const DATA_SCOPES = ['own', 'team', 'department', 'organization', 'custom'];

/**
 * Build a fully populated, all-disabled permissions object.
 * Optionally pass overrides to pre-enable specific module/action combos.
 */
function buildDefaultPermissions(overrides = {}) {
  const perms = {};
  for (const mod of MODULE_KEYS) {
    perms[mod] = {};
    for (const action of ACTION_KEYS) {
      perms[mod][action] = {
        enabled: overrides[mod]?.[action]?.enabled ?? false,
        dataScope: overrides[mod]?.[action]?.dataScope ?? 'own',
      };
    }
  }
  return perms;
}

/** All permissions enabled at organization scope — used by super_admin & admin seeds. */
function buildFullPermissions(dataScope = 'organization') {
  const perms = {};
  for (const mod of MODULE_KEYS) {
    perms[mod] = {};
    for (const action of ACTION_KEYS) {
      perms[mod][action] = { enabled: true, dataScope };
    }
  }
  return perms;
}

// ──────────────────────────────────────────────────────────────
// Default permission presets for the 6 system roles
// ──────────────────────────────────────────────────────────────

function superAdminPermissions() {
  return buildFullPermissions('organization');
}

function adminPermissions() {
  return buildFullPermissions('organization');
}

function hrPermissions() {
  const p = buildDefaultPermissions();
  const hrModules = ['employees', 'attendance', 'leave', 'payroll', 'recruitment', 'performance'];
  for (const mod of hrModules) {
    for (const action of ACTION_KEYS) {
      if (action !== 'manage_settings') {
        p[mod][action] = { enabled: true, dataScope: 'department' };
      }
    }
  }
  // Limited read access on supporting modules
  for (const mod of ['reports', 'teams', 'documents', 'announcements']) {
    p[mod].read   = { enabled: true, dataScope: 'department' };
    p[mod].export = { enabled: true, dataScope: 'department' };
  }
  return p;
}

function managerPermissions() {
  const p = buildDefaultPermissions();
  const ops = ['projects', 'tasks', 'clients', 'reports', 'teams', 'meetings', 'documents', 'announcements', 'tickets'];
  for (const mod of ops) {
    p[mod].create  = { enabled: true, dataScope: 'team' };
    p[mod].read    = { enabled: true, dataScope: 'team' };
    p[mod].update  = { enabled: true, dataScope: 'team' };
    p[mod].delete  = { enabled: true, dataScope: 'team' };
    p[mod].assign  = { enabled: true, dataScope: 'team' };
    p[mod].export  = { enabled: true, dataScope: 'team' };
    p[mod].approve = { enabled: true, dataScope: 'team' };
  }
  p.employees.read   = { enabled: true, dataScope: 'team' };
  p.performance.read = { enabled: true, dataScope: 'team' };
  p.attendance.create = { enabled: true, dataScope: 'own' };
  p.attendance.read   = { enabled: true, dataScope: 'own' };
  p.attendance.update = { enabled: true, dataScope: 'own' };
  p.leave.create = { enabled: true, dataScope: 'own' };
  p.leave.read = { enabled: true, dataScope: 'own' };
  p.chat.create = { enabled: true, dataScope: 'team' };
  p.chat.read = { enabled: true, dataScope: 'team' };
  p.chat.update = { enabled: true, dataScope: 'team' };
  p.chat.delete = { enabled: true, dataScope: 'team' };
  return p;
}

function teamLeadPermissions() {
  const p = buildDefaultPermissions();
  p.projects.read   = { enabled: true, dataScope: 'team' };
  p.projects.update = { enabled: true, dataScope: 'team' };
  p.tasks.create    = { enabled: true, dataScope: 'team' };
  p.tasks.read      = { enabled: true, dataScope: 'team' };
  p.tasks.update    = { enabled: true, dataScope: 'team' };
  p.tasks.assign    = { enabled: true, dataScope: 'team' };
  p.tasks.approve   = { enabled: true, dataScope: 'team' };
  p.teams.read      = { enabled: true, dataScope: 'team' };
  p.reports.read    = { enabled: true, dataScope: 'team' };
  p.documents.read  = { enabled: true, dataScope: 'team' };
  p.documents.create = { enabled: true, dataScope: 'team' };
  p.meetings.read   = { enabled: true, dataScope: 'team' };
  p.announcements.read = { enabled: true, dataScope: 'organization' };
  p.tickets.create  = { enabled: true, dataScope: 'team' };
  p.tickets.read    = { enabled: true, dataScope: 'team' };
  p.tickets.update  = { enabled: true, dataScope: 'team' };
  p.attendance.create = { enabled: true, dataScope: 'own' };
  p.attendance.read   = { enabled: true, dataScope: 'own' };
  p.attendance.update = { enabled: true, dataScope: 'own' };
  p.leave.create = { enabled: true, dataScope: 'own' };
  p.leave.read = { enabled: true, dataScope: 'own' };
  p.chat.create = { enabled: true, dataScope: 'team' };
  p.chat.read = { enabled: true, dataScope: 'team' };
  p.chat.update = { enabled: true, dataScope: 'team' };
  return p;
}

function teamMemberPermissions() {
  const p = buildDefaultPermissions();
  p.tasks.create    = { enabled: true, dataScope: 'own' };
  p.tasks.read      = { enabled: true, dataScope: 'team' };
  p.tasks.update    = { enabled: true, dataScope: 'own' };
  p.projects.read   = { enabled: true, dataScope: 'team' };
  p.documents.read  = { enabled: true, dataScope: 'team' };
  p.documents.create = { enabled: true, dataScope: 'own' };
  p.meetings.read   = { enabled: true, dataScope: 'team' };
  p.announcements.read = { enabled: true, dataScope: 'organization' };
  p.tickets.create  = { enabled: true, dataScope: 'own' };
  p.tickets.read    = { enabled: true, dataScope: 'own' };
  p.tickets.update  = { enabled: true, dataScope: 'own' };
  p.attendance.create = { enabled: true, dataScope: 'own' };
  p.attendance.read   = { enabled: true, dataScope: 'own' };
  p.attendance.update = { enabled: true, dataScope: 'own' };
  p.leave.create = { enabled: true, dataScope: 'own' };
  p.leave.read = { enabled: true, dataScope: 'own' };
  p.chat.create = { enabled: true, dataScope: 'team' };
  p.chat.read = { enabled: true, dataScope: 'team' };
  p.chat.update = { enabled: true, dataScope: 'own' };
  return p;
}

const ROLE_PERMISSION_PRESETS = {
  super_admin: superAdminPermissions,
  admin:       adminPermissions,
  hr:          hrPermissions,
  manager:     managerPermissions,
  team_lead:   teamLeadPermissions,
  team_member: teamMemberPermissions,
};

module.exports = {
  MODULES,
  MODULE_KEYS,
  ACTIONS,
  ACTION_KEYS,
  DATA_SCOPES,
  buildDefaultPermissions,
  buildFullPermissions,
  ROLE_PERMISSION_PRESETS,
};
