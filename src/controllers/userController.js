const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const PermissionAuditLog = require('../models/PermissionAuditLog');
const { permissionsCache } = require('../middleware/auth');

// @GET /api/users/:id/avatar
// Dedicated profile-image endpoint. Streams the user's uploaded avatar directly,
// or returns a generated SVG placeholder (with the user's initials) when they
// have not uploaded one — so callers never have to handle a broken image.
exports.getUserAvatar = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('avatar name');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Serve the uploaded avatar if it exists on disk.
    if (user.avatar) {
      const uploadsDir = path.join(__dirname, '../../uploads');
      const filePath = path.join(uploadsDir, path.basename(user.avatar));
      if (fs.existsSync(filePath)) {
        res.set('Cache-Control', 'private, max-age=86400');
        return res.sendFile(filePath);
      }
    }

    // Fallback: dynamically generate an SVG placeholder with the person's initials.
    const initials = String(user.name || '?')
      .split(' ')
      .map((p) => p[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
      `<rect width="200" height="200" fill="#4f46e5"/>` +
      `<text x="100" y="124" font-family="Arial, sans-serif" font-size="84" font-weight="bold" fill="#ffffff" text-anchor="middle">${initials}</text>` +
      `</svg>`;
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    return res.send(svg);
} catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/users
exports.getUsers = async (req, res) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const query = {};
    if (role) query.role = role;
    if (search) query.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }];

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    res.json({ success: true, total, page: Number(page), users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/users  (Admin creates users)
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, department, phone, company, shiftCode } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

    // Only super_admin can create super_admin users
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can create Super Admin users' });
    }

    const createData = { name, email, password, role, department, phone, company, shiftCode };
    if (req.file) createData.avatar = `/uploads/${req.file.filename}`;

    const user = await User.create(createData);
    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @PUT /api/users/:id
exports.updateUser = async (req, res) => {
  try {
    const { name, role, department, phone, company, isActive, customPermissions, shiftCode } = req.body;

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    // Only super_admin can change roles to/from super_admin
    if ((role === 'super_admin' || target.role === 'super_admin') && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can modify Super Admin users' });
    }

    const prevRole = target.role;
    const updates = { name, role, department, phone, company, isActive, shiftCode };
    if (customPermissions !== undefined) updates.customPermissions = customPermissions;
    if (req.file) updates.avatar = `/uploads/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    // Log role change
    if (role && role !== prevRole) {
      await PermissionAuditLog.create({
        action: 'user_role_changed',
        performedBy: req.user._id,
        targetUser: user._id,
        description: `User "${user.name}" role changed from "${prevRole}" to "${role}"`,
        before: { role: prevRole },
        after: { role },
        ipAddress: req.ip || '',
      });
    }

    // Invalidate cache if role changed
    if (role && role !== prevRole) {
      permissionsCache.delete(prevRole);
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    if (target.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can delete Super Admin users' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};