const mongoose = require('mongoose');

const permissionAuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        'role_created',
        'role_updated',
        'role_deleted',
        'role_cloned',
        'permissions_updated',
        'role_activated',
        'role_deactivated',
        'user_role_changed',
      ],
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    targetRole:  { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
    targetUser:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    description: { type: String, default: '' },
    before:      { type: mongoose.Schema.Types.Mixed, default: null },
    after:       { type: mongoose.Schema.Types.Mixed, default: null },
    ipAddress:   { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PermissionAuditLog', permissionAuditLogSchema);
