const Settings = require('../models/Settings');
const { getKanbanColumnsFromSettings, getDefaultKanbanColumns } = require('../utils/kanbanColumns');

let cached = null;
let cacheTime = 0;
const CACHE_MS = 5000;

exports.getActiveColumns = async () => {
  if (cached && Date.now() - cacheTime < CACHE_MS) return cached;
  const settings = await Settings.findOne().lean();
  cached = getKanbanColumnsFromSettings(settings);
  cacheTime = Date.now();
  return cached;
};

exports.clearColumnCache = () => {
  cached = null;
};

exports.validateTaskStatus = async (status) => {
  const columns = await exports.getActiveColumns();
  const valid = columns.some((c) => c.id === status);
  return { valid, columns, fallback: columns[0]?.id || 'todo' };
};

exports.getWipLimit = async (status) => {
  const columns = await exports.getActiveColumns();
  const col = columns.find((c) => c.id === status);
  return col?.wipLimit ?? null;
};

exports.getCompletedColumnIds = async () => {
  const columns = await exports.getActiveColumns();
  return columns.filter((c) => c.id === 'completed' || /done|complete/i.test(c.label)).map((c) => c.id);
};
