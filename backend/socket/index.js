import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

let ioInstance = null;

/**
 * Initializes the Socket.IO server.
 * @param {HttpServer} server - The HTTP server instance
 */
export function initSocketIO(server) {
  ioInstance = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for dev simplicity
      methods: ['GET', 'POST']
    }
  });

  // JWT Authentication middleware for Socket.IO
  ioInstance.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_querydesk_jwt_key_2026');
        socket.userId = decoded.id;
        return next();
      } catch (err) {
        console.error('[Socket] Auth error:', err.message);
        return next(new Error('Authentication error'));
      }
    }
    next();
  });

  ioInstance.on('connection', (socket) => {
    console.log(`Dashboard client connected: ${socket.id} (user: ${socket.userId || 'Guest'})`);

    if (socket.userId) {
      const room = `user_${socket.userId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} automatically joined user room: ${room}`);
    }

    socket.on('join', (room) => {
      socket.join(room);
      console.log(`Socket ${socket.id} joined room: ${room}`);
    });

    socket.on('disconnect', () => {
      console.log(`Dashboard client disconnected: ${socket.id}`);
    });
  });

  return ioInstance;
}

/**
 * Returns the initialized Socket.IO server instance.
 */
export function getSocketIO() {
  return ioInstance;
}
