const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');

let ioInstance = null;

function normalizeToken(rawToken = '') {
  const token = String(rawToken || '').trim();
  if (!token) return '';
  return token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token;
}

function resolveSocketToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  const headerToken = socket.handshake?.headers?.authorization;
  return normalizeToken(authToken || headerToken || '');
}

function buildCorsOriginGuard(corsOrigins = []) {
  return (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV === 'development') return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  };
}

async function joinMemberConversations(socket, userId) {
  const conversations = await ChatConversation.find({
    isArchived: false,
    participants: userId,
  }).select('_id');

  conversations.forEach((conversation) => {
    socket.join(`conversation:${conversation._id}`);
  });
}

function initializeChatSocket(httpServer, corsOrigins = []) {
  if (ioInstance) return ioInstance;

  ioInstance = new Server(httpServer, {
    cors: {
      origin: buildCorsOriginGuard(corsOrigins),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  ioInstance.use(async (socket, next) => {
    try {
      const token = resolveSocketToken(socket);
      if (!token) return next(new Error('Not authorized'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id role isActive');

      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.user = {
        id: String(user._id),
        role: user.role,
      };

      return next();
    } catch {
      return next(new Error('Token invalid or expired'));
    }
  });

  ioInstance.on('connection', async (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);

    try {
      await joinMemberConversations(socket, userId);
    } catch (err) {
      console.error('Socket joinMemberConversations failed:', err.message);
    }

    socket.on('chat:join', async ({ conversationId } = {}) => {
      if (!conversationId) return;
      try {
        const conversation = await ChatConversation.findOne({
          _id: conversationId,
          isArchived: false,
          participants: userId,
        }).select('_id');

        if (conversation) {
          socket.join(`conversation:${conversation._id}`);
        }
      } catch {
        // Ignore invalid join attempts.
      }
    });

    socket.on('chat:leave', ({ conversationId } = {}) => {
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
    });
  });

  return ioInstance;
}

function emitConversationEvent(conversationId, eventName, payload = {}) {
  if (!ioInstance || !conversationId || !eventName) return;
  ioInstance
    .to(`conversation:${conversationId}`)
    .emit(eventName, { conversationId: String(conversationId), ...payload });
}

function emitUsersEvent(userIds = [], eventName, payload = {}) {
  if (!ioInstance || !eventName || !Array.isArray(userIds) || userIds.length === 0) return;

  const uniqueUserIds = Array.from(new Set(userIds.map((id) => String(id)).filter(Boolean)));
  uniqueUserIds.forEach((userId) => {
    ioInstance.to(`user:${userId}`).emit(eventName, payload);
  });
}

module.exports = {
  initializeChatSocket,
  emitConversationEvent,
  emitUsersEvent,
};
