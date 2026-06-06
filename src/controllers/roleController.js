const Role = require('../models/Role');
const User = require('../models/User');
const PermissionAuditLog = require('../models/PermissionAuditLog');
const { buildDefaultPermissions, ROLE_PERMISSION_PRESETS } = require('../utils/permissions');
const { permissionsCache, loadEffectivePermissions } = require('../middleware/auth');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAudit(action, performedBy, targetRole, description, before, after, req) {
  try {
    await PermissionAuditLog.create({
      action,
      performedBy,
      targetRole: targetRole?._id || targetRole,
      description,
      before,
      after,
      ipAddress: req?.ip || '',
    });
  } catch (_) {
    // Audit failures must not break the request
  }
}

// ─── GET /api/roles ───────────────────────────────────────────────────────────
exports.getRoles = async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const query = includeInactive === 'true' ? {} : { isActive: true };
    const roles = await Role.find(query)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ hierarchy: 1, createdAt: 1 });

    // Attach user-count per role
    const roleCounts = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(roleCounts.map((r) => [r._id, r.count]));

    const result = roles.map((r) => ({
      ...r.toObject(),
      userCount: countMap[r.name] || 0,
    }));

    res.json({ success: true, roles: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/roles/:id ───────────────────────────────────────────────────────
exports.getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('clonedFrom', 'name displayName');
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/roles/by-name/:name ────────────────────────────────────────────
exports.getRoleByName = async (req, res) => {
  try {
    const role = await Role.findOne({ name: req.params.name.toLowerCase() });
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/roles ──────────────────────────────────────────────────────────
exports.createRole = async (req, res) => {
  try {
    const { name, displayName, description, color, hierarchy, permissions } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ success: false, message: 'name and displayName are required' });
    }

    const exists = await Role.findOne({ name: name.toLowerCase().trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Role name already exists' });

    const role = await Role.create({
      name: name.toLowerCase().trim(),
      displayName: displayName.trim(),
      description: description || '',
      color: color || '#6366f1',
      hierarchy: hierarchy ?? 99,
      permissions: permissions || buildDefaultPermissions(),
      isSystem: false,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await logAudit('role_created', req.user._id, role, `Role "${role.displayName}" created`, null, { name: role.name, displayName: role.displayName }, req);

    res.status(201).json({ success: true, role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── PUT /api/roles/:id ───────────────────────────────────────────────────────
exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });

    // Super admin role cannot be modified by non-super_admin
    if (role.name === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can modify the Super Admin role' });
    }

    const { displayName, description, color, hierarchy, isActive, permissions } = req.body;
    const before = {
      displayName: role.displayName,
      description: role.description,
      color: role.color,
      hierarchy: role.hierarchy,
      isActive: role.isActive,
      permissions: role.permissions,
    };

    if (displayName !== undefined) role.displayName = displayName.trim();
    if (description !== undefined) role.description = description;
    if (color !== undefined) role.color = color;
    if (hierarchy !== undefined) role.hierarchy = hierarchy;
    if (isActive !== undefined) role.isActive = isActive;
    if (permissions !== undefined) {
      role.permissions = permissions;
      role.markModified('permissions');
    }
    role.updatedBy = req.user._id;

    await role.save();

    // Invalidate cache for this role
    permissionsCache.delete(role.name);

    await logAudit(
      permissions !== undefined ? 'permissions_updated' : 'role_updated',
      req.user._id,
      role,
      `Role "${role.displayName}" updated`,
      before,
      { displayName: role.displayName, permissions: role.permissions },
      req
    );

    res.json({ success: true, role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE /api/roles/:id ────────────────────────────────────────────────────
exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });

    if (role.isSystem) {
      return res.status(400).json({ success: false, message: 'System roles cannot be deleted' });
    }

    const usersWithRole = await User.countDocuments({ role: role.name });
    if (usersWithRole > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role with ${usersWithRole} assigned user(s). Reassign users first.`,
      });
    }

    await Role.findByIdAndDelete(req.params.id);
    permissionsCache.delete(role.name);

    await logAudit('role_deleted', req.user._id, role, `Role "${role.displayName}" deleted`, { name: role.name }, null, req);

    res.json({ success: true, message: 'Role deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /api/roles/:id/clone ────────────────────────────────────────────────
exports.cloneRole = async (req, res) => {
  try {
    const source = await Role.findById(req.params.id);
    if (!source) return res.status(404).json({ success: false, message: 'Source role not found' });

    const { name, displayName } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ success: false, message: 'name and displayName required for clone' });
    }

    const exists = await Role.findOne({ name: name.toLowerCase().trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Role name already exists' });

    const cloned = await Role.create({
      name: name.toLowerCase().trim(),
      displayName: displayName.trim(),
      description: `Cloned from ${source.displayName}`,
      color: source.color,
      hierarchy: 99,
      permissions: JSON.parse(JSON.stringify(source.permissions)),
      isSystem: false,
      clonedFrom: source._id,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await logAudit('role_cloned', req.user._id, cloned, `Role "${source.displayName}" cloned as "${cloned.displayName}"`, null, { clonedFrom: source.name, name: cloned.name }, req);

    res.status(201).json({ success: true, role: cloned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/roles/audit-logs ────────────────────────────────────────────────
exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 30, roleId } = req.query;
    const query = roleId ? { targetRole: roleId } : {};

    const total = await PermissionAuditLog.countDocuments(query);
    const logs = await PermissionAuditLog.find(query)
      .populate('performedBy', 'name email role')
      .populate('targetRole', 'name displayName')
      .populate('targetUser', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ success: true, total, page: Number(page), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET /api/roles/my-permissions ───────────────────────────────────────────
exports.getMyPermissions = async (req, res) => {
  try {
    const permissions = await loadEffectivePermissions(req.user);
    res.json({ success: true, role: req.user.role, permissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
