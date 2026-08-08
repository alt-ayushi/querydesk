import ChannelSession from '../models/ChannelSession.js';
import WhatsAppService from '../services/WhatsAppService.js';
import TelegramService from '../services/TelegramService.js';
import { encrypt } from '../services/encryptionService.js';
import {
  startWhatsAppLogin,
  connectTelegramBot,
  logoutWhatsAppChannel,
  removeTelegramBotChannel
} from '../services/channelConnectionService.js';

/**
 * GET /api/channels/status
 * Returns current connection status of WhatsApp and Telegram channels for the authenticated user.
 */
export const getChannelsStatus = async (req, res) => {
  try {
    const sessions = await ChannelSession.find({ userId: req.user._id }).select('-botToken');
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/:channel/send
 * Sends a message from the dashboard to a WhatsApp or Telegram contact.
 */
export const sendMessage = async (req, res) => {
  try {
    const { channel } = req.params;
    const { target, message, conversationId } = req.body;

    if (!target || !message) {
      return res.status(400).json({ error: 'target and message are required' });
    }

    let savedMsg;
    if (channel === 'whatsapp') {
      savedMsg = await WhatsAppService.sendMessage(target, message, conversationId, req.user._id);
    } else if (channel === 'telegram') {
      savedMsg = await TelegramService.sendMessage(target, message, conversationId, req.user._id);
    } else {
      return res.status(400).json({ error: `Unsupported channel: ${channel}` });
    }

    res.json({ success: true, message: savedMsg });
  } catch (error) {
    console.error('[Channel] sendMessage error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/whatsapp/connect
 * Starts the WhatsApp login session by spawning the CLI and generating a QR code.
 */
export const connectWhatsApp = async (req, res) => {
  try {
    startWhatsAppLogin(req.user._id);
    res.json({ success: true, message: 'WhatsApp connection process started. Check status for QR code updates.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/telegram/connect
 * Stores encrypted bot token and adds the Telegram bot channel in OpenClaw.
 */
export const connectTelegram = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Telegram Bot token is required' });

    // Validate bot token with Telegram getMe API
    const botInfo = await connectTelegramBot(req.user._id, token);

    // Encrypt token before saving
    const encryptedToken = encrypt(token);

    // Deactivate any older sessions using this exact same bot token for other users
    await ChannelSession.updateMany(
      { channel: 'telegram', botToken: encryptedToken, userId: { $ne: req.user._id } },
      { connected: false }
    );

    // Save/Update in DB FIRST so connected: true and correct botUsername are persisted
    const session = await ChannelSession.findOneAndUpdate(
      { userId: req.user._id, channel: 'telegram' },
      {
        botToken: encryptedToken,
        connected: true,
        botUsername: botInfo?.username || token.split(':')[0]
      },
      { upsert: true, new: true }
    );

    // Now trigger listeners so polling/webhook starts for the connected session
    TelegramService.initTelegramListeners().catch(err => console.error('[TG Direct Listener] Init error:', err.message));

    res.json({ success: true, channel: session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/:channel/disconnect
 * Disconnects and removes the channel connection for the user.
 */
export const disconnectChannel = async (req, res) => {
  try {
    const { channel } = req.params;

    if (channel === 'whatsapp') {
      await logoutWhatsAppChannel(req.user._id);
    } else if (channel === 'telegram') {
      await removeTelegramBotChannel(req.user._id);
    } else {
      return res.status(400).json({ error: 'Invalid channel type' });
    }

    await ChannelSession.findOneAndDelete({ userId: req.user._id, channel });
    res.json({ success: true, message: `Disconnected ${channel} channel successfully.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/whatsapp/webhook
 * Called by OpenClaw when a WhatsApp message is received.
 */
export const handleWhatsAppWebhook = async (req, res) => {
  try {
    const { from, body, id: providerMessageId, timestamp, pushName, fromMe } = req.body;

    if (!from || !body) {
      return res.status(400).json({ error: 'from and body are required' });
    }

    if (fromMe) return res.json({ success: true, skipped: 'fromMe' });

    WhatsAppService.handleIncomingMessage(from, body, providerMessageId, timestamp, pushName || '', true)
      .catch(err => console.error('[Webhook/WA] Handler error:', err.message));

    res.json({ success: true });
  } catch (error) {
    console.error('[Channel] whatsapp webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/channels/telegram/webhook/:userId?
 * Dual-route webhook handler for Telegram Bot API & OpenClaw legacy format.
 * Validates update, returns HTTP 200 immediately, and delegates processing asynchronously to TelegramService.
 */
export const handleTelegramWebhook = async (req, res) => {
  try {
    const explicitUserId = req.params.userId || req.query.userId || req.body?.userId || null;
    const body = req.body || {};

    console.log('[Telegram Webhook] Received payload for userId:', explicitUserId || 'DB session lookup');

    // 1. Legacy OpenClaw Format Support
    if (body.from && body.body) {
      if (body.fromMe) return res.json({ success: true, skipped: 'fromMe' });
      const contactName = [body.firstName, body.lastName].filter(Boolean).join(' ') || body.username || '';

      // Return HTTP 200 immediately
      res.json({ success: true });

      // Process asynchronously
      TelegramService.handleIncomingMessage(
        body.from,
        body.body,
        body.id,
        body.timestamp,
        contactName,
        true,
        explicitUserId
      ).catch(err => console.error('[Webhook/TG Legacy] Processing error:', err.message));
      return;
    }

    // 2. Standard Telegram Bot API Update Support
    const update = body;
    const msg = update.message || update.edited_message;

    if (!msg) {
      // Return HTTP 200 for non-message update types (e.g. inline_query, my_chat_member) to avoid retries
      return res.json({ success: true, skipped: 'Non-message update type' });
    }

    // Return HTTP 200 immediately before AI / DB processing to prevent Telegram webhook timeout retries
    res.json({ success: true });

    // Delegate processing asynchronously to TelegramService payload handler
    TelegramService.processWebhookUpdate(update, explicitUserId)
      .catch(err => console.error('[Webhook/TG] Async processing error:', err.message));

  } catch (error) {
    console.error('[Channel] Telegram webhook error:', error.message);
    if (!res.headersSent) {
      res.json({ success: true, warning: 'Error caught during validation' });
    }
  }
};
