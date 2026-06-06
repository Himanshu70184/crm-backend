const mongoose = require('mongoose');
const { MODULE_KEYS, ACTION_KEYS, buildDefaultPermissions } = require('../utils/permissions');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      // e.g. "super_admin", "admin", "hr", "manager", "team_lead", "team_member"
    },
    displayName: { type: String, required: true, trim: true },
    description:  { type: String, default: '' },
    color:        { type: String, default: '#6366f1' }, // hex badge color
    hierarchy:    { type: Number, default: 99 },        // lower = higher authority; 1=super_admin
    isSystem:     { type: Boolean, default: false },    // system roles cannot be deleted
    isActive:     { type: Boolean, default: true },

    /**
     * permissions shape:
     * {
     *   "<module>": {
     *     "<action>": { enabled: Boolean, dataScope: String }
     *   }
     * }
     */
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => buildDefaultPermissions(),
    },

    clonedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Ensure the permissions object always contains all modules/actions
roleSchema.pre('save', function (next) {
  const perms = this.permissions || {};
  for (const mod of MODULE_KEYS) {
    if (!perms[mod]) perms[mod] = {};
    for (const action of ACTION_KEYS) {
      if (!perms[mod][action]) {
        perms[mod][action] = { enabled: false, dataScope: 'own' };
      }
    }
  }
  this.permissions = perms;
  this.markModified('permissions');
  next();
});

module.exports = mongoose.model('Role', roleSchema);
