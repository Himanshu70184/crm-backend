const ORGANIZATION_MODULES = [
  { key: 'projects', label: 'Projects' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'timeTracking', label: 'Time Tracking' },
  { key: 'reports', label: 'Reports' },
  { key: 'chat', label: 'Chat' },
  { key: 'clients', label: 'Clients' },
  { key: 'team', label: 'Team' },
  { key: 'notifications', label: 'Notifications' },
];

function buildOrganizationModules(overrides = {}) {
  return ORGANIZATION_MODULES.reduce((acc, moduleDef) => {
    acc[moduleDef.key] = overrides?.[moduleDef.key] !== false;
    return acc;
  }, {});
}

module.exports = {
  ORGANIZATION_MODULES,
  buildOrganizationModules,
};