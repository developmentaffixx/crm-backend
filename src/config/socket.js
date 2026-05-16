const { Server } = require('socket.io');

let io = null;

/**
 * Initialize Socket.IO with the HTTP server
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // Join a company room (for multi-tenant isolation)
    socket.on('join:company', (companyId) => {
      socket.join(`company:${companyId}`);
      console.log(`   → ${socket.id} joined company:${companyId}`);
    });

    // Join a user-specific room (for targeted notifications)
    socket.on('join:user', (userId) => {
      socket.join(`user:${userId}`);
      console.log(`   → ${socket.id} joined user:${userId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Get the Socket.IO instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initSocket(server) first.');
  }
  return io;
}

/**
 * Emit a real-time event to all connected clients
 * @param {string} event - Event name (e.g., 'leads:created')
 * @param {object} data  - Payload to send
 * @param {string} [room] - Optional room to emit to (e.g., 'company:1')
 */
function emitEvent(event, data = {}, room = null) {
  if (!io) return;
  if (room) {
    io.to(room).emit(event, data);
  } else {
    io.emit(event, data);
  }
}

module.exports = { initSocket, getIO, emitEvent };
