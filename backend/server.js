import express from 'express';
// QueryDesk server entry point
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import { initSocketIO } from './socket/index.js';
import apiRoutes from './routes/api.js';
import { initWhatsAppSessions } from './services/channelConnectionService.js';
import TelegramService from './services/TelegramService.js';

import { validateVisionStartup } from './services/aiService.js';
import { runMigration } from './migrate.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB, then start native channel listeners & run startup checks
connectDB().then(() => {
  runMigration();
  validateVisionStartup();
  initWhatsAppSessions();
  TelegramService.initTelegramListeners();
});

const app = express();
const server = http.createServer(app);

// Middlewares
app.use(cors());

// Route-aware JSON parser: 50mb payload limit for image chat endpoint, standard limit for all other routes
app.use((req, res, next) => {
  if (req.path === '/api/chat' || req.originalUrl === '/api/chat') {
    return express.json({ limit: '50mb' })(req, res, next);
  }
  return express.json()(req, res, next);
});

// Request logger middleware
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api', apiRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize Socket.IO
initSocketIO(server);

// OpenClaw is now started after MongoDB connects (see connectDB().then above)

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`QueryDesk Backend Server listening on port ${PORT}`);
});
