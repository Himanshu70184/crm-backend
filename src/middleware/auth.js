const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { buildOrganizationModules, ORGANIZATION_MODULES } = require('../utils/organizationModules');

// ─── Simple in-memory permissions cache (role name → permissions object) ──────
// TTL: 5 minutes. Invalidated explicitly on role updates.
const CACHE_TTL_MS = 5 * 60 * 1000;
const permissionsCache = new Map(); // Map<roleName, { perms, expiresAt }>
const ORGANIZATION_MODULES_TTL_MS = 60 * 1000;
let organizationModulesCache = null;

function getCachedPermissions(roleName) {
  const entry = permissionsCache.get(roleName);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    permissionsCache.delete(roleName);
    return null;
  }
  return entry.perms;
}

function setCachedPermissions(roleName, perms) {
  permissionsCache.set(roleName, { perms, expiresAt: Date.now() + CACHE_TTL_MS });
}

function invalidateOrganizationModulesCache() {
  organizationModulesCache = null;
}

async function loadOrganizationModules() {
  if (organizationModulesCache && Date.now() <= organizationModulesCache.expiresAt) {
    return organizationModulesCache.value;
  }

  const settings = await Settings.findOne().select('organizationModules').lean();
  const value = buildOrganizationModules(settings?.organizationModules);
  organizationModulesCache = {
    value,
    expiresAt: Date.now() + ORGANIZATION_MODULES_TTL_MS,
  };
  return value;
}

const ORGANIZATION_MODULE_LABELS = ORGANIZATION_MODULES.reduce((acc, moduleDef) => {
  acc[moduleDef.key] = moduleDef.label;
  return acc;
}, {});

// ─── Load effective permissions for a user ─────────────────────────────────────
async function loadEffectivePermissions(user) {
  const {
    buildDefaultPermissions,
    buildFullPermissions,
    ROLE_PERMISSION_PRESETS,
  } = require('../utils/permissions');

  if (user.role === 'super_admin') {
    return buildFullPermissions('organization');
  }

  // Try cache first
  let rolePerms = getCachedPermissions(user.role);
  if (!rolePerms) {
    const Role = require('../models/Role');
    const roleDoc = await Role.findOne({ name: user.role });
    rolePerms = roleDoc ? roleDoc.permissions : null;
    if (rolePerms) setCachedPermissions(user.role, rolePerms);
  }

  const presetFactory = ROLE_PERMISSION_PRESETS[user.role];
  let effective = presetFactory ? presetFactory() : buildDefaultPermissions();

  if (!presetFactory && rolePerms) {
    effective = mergePermissions(effective, rolePerms);
  }

  // Layer custom per-user overrides
  if (user.customPermissions) {
    effective = mergePermissions(effective, user.customPermissions);
  }

  // Layer non-expired temporary permissions
  if (user.temporaryPermissions?.length) {
    const now = new Date();
    for (const tp of user.temporaryPermissions) {
      if (new Date(tp.expiresAt) > now) {
        effective = mergePermissions(effective, tp.permissions);
      }
    }
  }

  return effective;
}

function mergePermissions(base, override) {
  const result = JSON.parse(JSON.stringify(base));
  for (const [mod, actions] of Object.entries(override || {})) {
    if (!result[mod]) result[mod] = {};
    for (const [action, val] of Object.entries(actions || {})) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        result[mod][action] = { ...(result[mod][action] || {}), ...val };
      } else {
        result[mod][action] = val;
      }
    }
  }
  return result;
}

// ─── protect ─────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user || !req.user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

// ─── authorize (role-based, backward compatible) ──────────────────────────────
// Maps legacy roles to new system: 'admin' matches both 'admin' and 'super_admin'
const ROLE_HIERARCHY = {
  super_admin: 1,
  admin:       2,
  hr:          3,
  manager:     4,
  team_lead:   5,
  team_member: 6,
  member:      6, // legacy alias
  client:      10,
};

const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // super_admin always passes
    if (req.user.role === 'super_admin') return next();

    // Expand legacy roles: if 'admin' is in allowedRoles, also accept 'super_admin'
    const expanded = new Set(allowedRoles);
    if (expanded.has('admin')) expanded.add('super_admin');
    if (expanded.has('member')) expanded.add('team_member');
    if (expanded.has('manager')) { expanded.add('team_lead'); }

    if (!expanded.has(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized for this action`,
      });
    }
    next();
  };
};

// ─── checkPermission (dynamic RBAC) ──────────────────────────────────────────
/**
 * Permission guard middleware.
 * Usage: router.post('/projects', protect, checkPermission('projects', 'create'), handler)
 * After this middleware, req.dataScope contains the effective data scope.
 */
const checkPermission = (module, action) => async (req, res, next) => {
  try {
    // super_admin and admin bypass all permission checks
    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
      req.dataScope = 'organization';
      return next();
    }

    const permissions = await loadEffectivePermissions(req.user);
    const perm = permissions?.[module]?.[action];

    if (!perm?.enabled) {
      return res.status(403).json({
        success: false,
        message: `You do not have permission to ${action} ${module}`,
      });
    }

    req.dataScope = perm.dataScope || 'own';
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Permission check failed' });
  }
};

const enforceOrganizationModule = (moduleKey) => async (req, res, next) => {
  try {
    const enabledModules = await loadOrganizationModules();

    if (enabledModules?.[moduleKey] === false) {
      return res.status(403).json({
        success: false,
        message: `${ORGANIZATION_MODULE_LABELS[moduleKey] || 'This module'} is disabled for this organization`,
        code: 'MODULE_DISABLED',
        module: moduleKey,
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Organization module check failed' });
  }
};

module.exports = {
  protect,
  authorize,
  checkPermission,
  enforceOrganizationModule,
  invalidateOrganizationModulesCache,
  permissionsCache,
  loadEffectivePermissions,
};
