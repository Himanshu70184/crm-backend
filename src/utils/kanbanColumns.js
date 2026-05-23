const DEFAULT_KANBAN_COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'slate', order: 0, wipLimit: null },
  { id: 'in_progress', label: 'In Progress', color: 'indigo', order: 1, wipLimit: 5 },
  { id: 'in_review', label: 'In Review', color: 'amber', order: 2, wipLimit: 3 },
  { id: 'completed', label: 'Completed', color: 'emerald', order: 3, wipLimit: null },
  { id: 'blocked', label: 'Blocked', color: 'red', order: 4, wipLimit: 2 },
];

exports.getDefaultKanbanColumns = () => DEFAULT_KANBAN_COLUMNS.map((c) => ({ ...c }));

exports.slugifyColumnId = (label) =>
  String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `phase_${Date.now()}`;

exports.normalizeKanbanColumns = (columns) => {
  if (!columns?.length) return exports.getDefaultKanbanColumns();
  return [...columns]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c, i) => {
      const label = (c.label || c.id || `Phase ${i + 1}`).trim();
      const id = (c.id || exports.slugifyColumnId(label)).trim();
      return {
        id,
        label,
        color: c.color || 'slate',
        order: i,
        wipLimit: c.wipLimit ?? null,
      };
    });
};

exports.getKanbanColumnsFromSettings = (settings) =>
  exports.normalizeKanbanColumns(settings?.kanbanColumns);

exports.isValidColumnId = (columns, status) => columns.some((c) => c.id === status);

module.exports.DEFAULT_KANBAN_COLUMNS = DEFAULT_KANBAN_COLUMNS;
