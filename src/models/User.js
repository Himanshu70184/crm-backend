const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: {
    type: String,
    // Required only for non-client roles
    required: function () {
      return this.role !== 'client';
    },
    minlength: 6,
    select: false,
  },
    role: {
      type: String,
      // Includes legacy values ('member', 'client') for backward compatibility
      enum: ['super_admin', 'admin', 'hr', 'manager', 'team_lead', 'team_member', 'member', 'client'],
      default: 'team_member',
    },
    // Optional: additional roles for multi-role users
    additionalRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Role' }],
    // Per-user permission overrides (takes precedence over role permissions)
    customPermissions: { type: mongoose.Schema.Types.Mixed, default: null },
    // Temporary permissions with expiry
    temporaryPermissions: [
      {
        permissions: { type: mongoose.Schema.Types.Mixed },
        expiresAt: { type: Date, required: true },
        grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String, default: '' },
      },
    ],
    avatar: { type: String, default: '' },
    department: { type: String, default: '' },
    phone: { type: String, default: '' },
    // Client-specific field — company/organization name the client belongs to.
    company: { type: String, default: '' },
    shiftCode: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  // ✅ ADD !this.password HERE
  if (!this.password || !this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);