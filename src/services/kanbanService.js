const Settings = require('../models/Settings');
const Project = require('../models/Project');
const {
  getKanbanColumnsFromSettings,
  getKanbanColumnsFromProject,
  getDefaultKanbanColumns,
} = require('../utils/kanbanColumns');

let globalCached = null;
let globalCacheTime = 0;
const projectCache = new Map();
const CACHE_MS = 5000;

const getGlobalColumns = async () => {
  if (globalCached && Date.now() - globalCacheTime < CACHE_MS) return globalCached;
  const settings = await Settings.findOne().lean();
  globalCached = getKanbanColumnsFromSettings(settings);
  globalCacheTime = Date.now();
  return globalCached;
};

exports.getActiveColumns = async (projectId = null) => {
  if (!projectId) return getGlobalColumns();

  const key = String(projectId);
  const cachedProject = projectCache.get(key);
  if (cachedProject && Date.now() - cachedProject.cacheTime < CACHE_MS) {
    return cachedProject.columns;
  }

  const project = await Project.findById(projectId).select('kanbanConfig.columns').lean();
  const projectColumns = getKanbanColumnsFromProject(project);
  const columns = projectColumns?.length ? projectColumns : await getGlobalColumns();
  projectCache.set(key, { columns, cacheTime: Date.now() });
  return columns;
};

exports.clearColumnCache = (projectId = null) => {
  if (projectId) {
    projectCache.delete(String(projectId));
    return;
  }

  globalCached = null;
  globalCacheTime = 0;
  projectCache.clear();
};

exports.validateTaskStatus = async (status, projectId = null) => {
  const columns = await exports.getActiveColumns(projectId);
  const valid = columns.some((c) => c.id === status);
  return { valid, columns, fallback: columns[0]?.id || getDefaultKanbanColumns()[0].id };
};

exports.getWipLimit = async (status, projectId = null) => {
  const columns = await exports.getActiveColumns(projectId);
  const col = columns.find((c) => c.id === status);
  return col?.wipLimit ?? null;
};

exports.getCompletedColumnIds = async (projectId = null) => {
  const columns = await exports.getActiveColumns(projectId);
  return columns.filter((c) => c.id === 'completed' || /done|complete/i.test(c.label)).map((c) => c.id);
};
