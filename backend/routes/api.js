import express from 'express';
import { register, login, onboardUser, autoLogin } from '../controllers/authController.js';
import {
  handleWebChat,
  getConversations,
  getMessages,
  renameConversation,
  deleteConversation
} from '../controllers/chatController.js';
import {
  getChannelsStatus,
  sendMessage,
  connectWhatsApp,
  connectTelegram,
  disconnectChannel,
  handleWhatsAppWebhook,
  handleTelegramWebhook
} from '../controllers/channelController.js';
import { getStatus } from '../controllers/settingController.js';
import { getMedia } from '../controllers/mediaController.js';
import {
  uploadMiddleware,
  uploadDocument,
  getDocuments,
  getDocumentById,
  deleteDocument,
  triggerVisualProcess,
  getDocumentVisuals,
  handleMultimodalRetrieval,
  handleMultimodalChat
} from '../controllers/documentController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// ── Auth ─────────────────────────────────────────────────────────────────────
router.get('/auth/auto-login', autoLogin);
router.post('/auth/auto-login', autoLogin);
router.post('/auth/register', register);
router.post('/auth/login', login);
router.post('/auth/onboard', protect, onboardUser);

// ── Conversations & Messages (Protected) ─────────────────────────────────────
router.get('/conversations', protect, getConversations);
router.get('/messages/:conversationId', protect, getMessages);
router.post('/chat', protect, handleWebChat);
router.patch('/conversations/:conversationId', protect, renameConversation);
router.delete('/conversations/:conversationId', protect, deleteConversation);

// ── Documents & Multimodal RAG (Protected) ──────────────────────────────────
router.post('/documents/upload', protect, uploadMiddleware, uploadDocument);
router.get('/documents', protect, getDocuments);
router.get('/documents/:id', protect, getDocumentById);
router.delete('/documents/:id', protect, deleteDocument);
router.post('/documents/:id/visual-process', protect, triggerVisualProcess);
router.get('/documents/:id/visuals', protect, getDocumentVisuals);
router.post('/retrieval/multimodal', protect, handleMultimodalRetrieval);
router.post('/chat/multimodal', protect, handleMultimodalChat);

// ── Channel Status & Send (Protected) ────────────────────────────────────────
router.get('/channels/status', protect, getChannelsStatus);
router.post('/channels/:channel/send', protect, sendMessage);
router.post('/channels/whatsapp/connect', protect, connectWhatsApp);
router.post('/channels/telegram/connect', protect, connectTelegram);
router.post('/channels/:channel/disconnect', protect, disconnectChannel);

// ── System Status & Media (Protected) ─────────────────────────────────────────
router.get('/status', protect, getStatus);
router.get('/media', protect, getMedia);

// ── Inbound Webhooks (No auth — called by Telegram / OpenClaw) ──────────────────
router.post('/channels/whatsapp/webhook', handleWhatsAppWebhook);
router.post('/channels/telegram/webhook/:userId?', handleTelegramWebhook);

export default router;
