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

    // Encrypt token before saving
    const encryptedToken = encrypt(token);

    // Add channel to OpenClaw
    await connectTelegramBot(req.user._id, token);

    // Save/Update in DB
    const session = await ChannelSession.findOneAndUpdate(
      { userId: req.user._id, channel: 'telegram' },
      {
        botToken: encryptedToken,
        connected: true,
        botUsername: token.split(':')[0] // Extracted bot ID as fallback username
      },
      { upsert: true, new: true }
    );

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
 * POST /api/channels/telegram/webhook
 * Called by OpenClaw when a Telegram message is received.
 */
export const handleTelegramWebhook = async (req, res) => {
  try {
    const { from, body, id: providerMessageId, timestamp, firstName, lastName, username, fromMe } = req.body;

    if (!from || !body) {
      return res.status(400).json({ error: 'from and body are required' });
    }

    if (fromMe) return res.json({ success: true, skipped: 'fromMe' });

    const contactName = [firstName, lastName].filter(Boolean).join(' ') || username || '';

    TelegramService.handleIncomingMessage(from, body, providerMessageId, timestamp, contactName, true)
      .catch(err => console.error('[Webhook/TG] Handler error:', err.message));

    res.json({ success: true });
  } catch (error) {
    console.error('[Channel] telegram webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
