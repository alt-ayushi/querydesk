/**
 * TelegramService.js
 *
 * Direct Telegram Bot API Service (No OpenClaw dependency).
 *   - Outbound: Sends messages directly via Telegram HTTPS REST API (`https://api.telegram.org/bot<token>/sendMessage`)
 *   - Inbound: Processes webhooks/polling, updates DB, emits Socket.IO events, and calls `generateAIResponseForConversation`
 */
import axios from 'axios';
import { generateAIResponseForConversation } from './aiService.js';
import ConversationService from './ConversationService.js';
import MessageRepository from '../repositories/MessageRepository.js';
import ChannelSession from '../models/ChannelSession.js';
import { decrypt } from './encryptionService.js';
import { getSocketIO } from '../socket/index.js';
import { formatAIResponse } from '../utils/formatResponse.js';

let pollingTimers = new Map();

/**
 * Sends a message directly to a Telegram chat using the Telegram Bot API.
 * @param {string} botToken - Unencrypted Telegram Bot Token
 * @param {string} chatId - Telegram chat_id (peerId)
 * @param {string} text - Message text
 */
export async function sendTelegramMessageDirect(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const MAX_LEN = 4000;

  try {
    if (text.length > MAX_LEN) {
      let lastResult = null;
      for (let i = 0; i < text.length; i += MAX_LEN) {
        const chunk = text.slice(i, i + MAX_LEN);
        const response = await axios.post(url, {
          chat_id: chatId,
          text: chunk
        }, { timeout: 15000 });
        if (response.data && response.data.ok) {
          lastResult = response.data.result;
        }
      }
      return lastResult;
    }

    const response = await axios.post(url, {
      chat_id: chatId,
      text: text
    }, { timeout: 15000 });

    if (!response.data || !response.data.ok) {
      throw new Error(`Telegram API error: ${response.data?.description || 'Unknown error'}`);
    }
    return response.data.result;
  } catch (err) {
    const errorMsg = err.response?.data?.description || err.message;
    console.error(`[Telegram Direct API Error] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

class TelegramService {

  // ── Dashboard → Telegram Mobile ────────────────────────────────────────────
  async sendMessage(peerId, text, conversationId, userId, overrideBotToken = null) {
    console.log(`[Telegram Direct] Dashboard → mobile: ${peerId}, user: ${userId}`);
    const io = getSocketIO();

    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'telegram', peerId, userId
    });

    const savedMsg = await MessageRepository.create({
      userId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'telegram',
      role: 'assistant',
      direction: 'outbound',
      text,
      status: 'pending',
      timestamp: new Date()
    });

    await ConversationService.updateConversationDetails(conversation._id, text, 0);

    if (io) {
      io.to(`user_${userId}`).emit('message:new', savedMsg);
    }

    try {
      let botToken = overrideBotToken;
      if (!botToken) {
        // Extract botUsername from scoped peerId if present (e.g. "5904904075_QueryDeskk_bot" -> "QueryDeskk_bot")
        const parts = String(peerId).split('_');
        const embeddedBotUsername = parts.length > 1 ? parts.slice(1).join('_') : null;

        if (embeddedBotUsername) {
          const session = await ChannelSession.findOne({ userId, channel: 'telegram', botUsername: embeddedBotUsername, connected: true });
          if (session && session.botToken) {
            botToken = decrypt(session.botToken);
          }
        }

        if (!botToken) {
          const session = await ChannelSession.findOne({ userId, channel: 'telegram', connected: true }).sort({ updatedAt: -1 });
          if (!session || !session.botToken) {
            throw new Error('Telegram bot is not connected for this user.');
          }
          botToken = decrypt(session.botToken);
        }
      }

      if (!botToken) {
        throw new Error('Failed to decrypt or find Telegram bot token.');
      }

      // Extract raw Telegram numeric chat_id from peerId (e.g. "5904904075_QueryDeskk_bot" -> "5904904075")
      const rawTelegramChatId = String(peerId).split('_')[0].split(':')[0];

      // Send directly via Telegram Bot API
      const result = await sendTelegramMessageDirect(botToken, rawTelegramChatId, text);

      savedMsg.status = 'sent';
      if (result && result.message_id) {
        savedMsg.providerMessageId = String(result.message_id);
      }
      await savedMsg.save();

      console.log('[TRACE 8/9] Assistant message stored:', savedMsg._id);
      console.log('[TRACE 9/9] Telegram sendMessage executed');
      if (io) io.to(`user_${userId}`).emit('message:update', savedMsg);
      return savedMsg;

    } catch (err) {
      console.error(`[Telegram Direct] Delivery failed:`, err.message);
      savedMsg.status = 'failed';
      await savedMsg.save();
      if (io) io.to(`user_${userId}`).emit('message:update', savedMsg);
      throw err;
    }
  }

  // ── Inbound Telegram → AI → Outbound Direct Reply ─────────────────────────
  async handleIncomingMessage(peerId, text, providerMessageId, timestamp, contactName = '', isUser = true, userId = null, botToken = null) {
    const io = getSocketIO();
    console.log('[TRACE 2/9] handleIncomingMessage entered');
    console.log(`[Telegram Direct] Incoming [isUser=${isUser}] from ${peerId}: "${text.slice(0, 80)}" for user ${userId}`);

    // ── 1. Resolve conversation ───────────────────────────────────────────────
    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'telegram',
      peerId,
      userId,
      contactData: { name: contactName }
    });

    const finalUserId = userId || conversation.userId;
    console.log('[TRACE 3/9] Conversation ID:', conversation._id);
    console.log('[TRACE 4/9] Contact ID:', conversation.contactId);
    console.log('[TRACE 5/9] User ID:', finalUserId);

    // ── 2. Deduplicate ────────────────────────────────────────────────────────
    if (providerMessageId) {
      const existing = await MessageRepository.findByProviderMessageId(String(providerMessageId), 'telegram', conversation._id);
      if (existing) {
        console.log(`[Telegram Direct] Duplicate message ${providerMessageId} in conv ${conversation._id}, skipping`);
        return existing;
      }
    }

    if (!isUser) {
      const MessageModel = (await import('../models/Message.js')).default;
      const lastMsg = await MessageModel.findOne({ conversationId: conversation._id }).sort({ timestamp: -1 });
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.text === text) {
        return lastMsg;
      }
    }

    // ── 3. Save message to DB ────────────────────────────────────────────────
    const savedMsg = await MessageRepository.create({
      userId: finalUserId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'telegram',
      role: isUser ? 'user' : 'assistant',
      direction: isUser ? 'inbound' : 'outbound',
      text,
      status: isUser ? 'delivered' : 'sent',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      providerMessageId: providerMessageId ? String(providerMessageId) : undefined
    });

    await ConversationService.updateConversationDetails(conversation._id, text, isUser ? 1 : 0);

    // ── 4. Emit to dashboard via Socket.IO ──────────────────────────────────
    if (io) {
      io.to(`user_${finalUserId}`).emit('message:new', savedMsg);
    }

    // ── 5. Trigger AI turn if message is inbound from user ───────────────────
    if (isUser) {
      (async () => {
        try {
          if (io) io.to(`user_${finalUserId}`).emit('typing:start', { conversationId: conversation._id });

          console.log('[TRACE 6/9] generateAIResponseForConversation called');
          // Request AI response string from decoupled AI layer
          const aiResponse = await generateAIResponseForConversation({
            conversationId: conversation._id,
            userId: finalUserId
          });

          if (aiResponse) {
            const formattedResponse = formatAIResponse(aiResponse, 'telegram');
            console.log('[TRACE 7/9] Formatted response received:', formattedResponse.slice(0, 60));
            console.log(`[Telegram Direct] AI response generated: "${formattedResponse.slice(0, 50)}..."`);
            // Deliver response text via channel transport using exact botToken
            await this.sendMessage(peerId, formattedResponse, conversation._id, finalUserId, botToken);
          }
        } catch (err) {
          console.error('[Telegram Direct] AI automatic responder error:', err.message);
        } finally {
          if (io) io.to(`user_${finalUserId}`).emit('typing:stop', { conversationId: conversation._id });
        }
      })();
    }

    return savedMsg;
  }

  // ── Inbound Telegram Photo → Vision AI ─────────────────────────────────────
  async handleIncomingPhotoMessage(peerId, photoArray, caption, providerMessageId, timestamp, contactName = '', isUser = true, userId = null, botToken = null) {
    const io = getSocketIO();
    console.log(`[Telegram Direct] Incoming Photo from ${peerId} for user ${userId}`);

    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'telegram',
      peerId,
      userId,
      contactData: { name: contactName }
    });

    const finalUserId = userId || conversation.userId;

    if (providerMessageId) {
      const existing = await MessageRepository.findByProviderMessageId(String(providerMessageId), 'telegram', conversation._id);
      if (existing) return existing;
    }

    let imageBase64 = null;
    try {
      if (botToken && photoArray && photoArray.length > 0) {
        const largestPhoto = photoArray[photoArray.length - 1];
        const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
          params: { file_id: largestPhoto.file_id },
          timeout: 10000
        });

        if (fileRes.data && fileRes.data.ok && fileRes.data.result?.file_path) {
          const filePath = fileRes.data.result.file_path;
          const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
          const imgRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 15000 });
          const base64Str = Buffer.from(imgRes.data).toString('base64');
          imageBase64 = `data:image/jpeg;base64,${base64Str}`;
        }
      }
    } catch (downloadErr) {
      console.error('[Telegram Direct] Photo download failed:', downloadErr.message);
    }

    const prompt = caption || 'Describe this image.';

    const savedMsg = await MessageRepository.create({
      userId: finalUserId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'telegram',
      role: 'user',
      direction: 'inbound',
      messageType: 'image',
      imageUrl: imageBase64 || undefined,
      text: prompt,
      status: 'delivered',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      providerMessageId: providerMessageId ? String(providerMessageId) : undefined
    });

    await ConversationService.updateConversationDetails(conversation._id, `📷 ${prompt}`, 1);

    if (io) io.to(`user_${finalUserId}`).emit('message:new', savedMsg);

    if (isUser) {
      (async () => {
        try {
          if (io) io.to(`user_${finalUserId}`).emit('typing:start', { conversationId: conversation._id });

          let aiResponse = '';
          if (imageBase64) {
            const { generateVisionAIResponseForConversation } = await import('./aiService.js');
            aiResponse = await generateVisionAIResponseForConversation({
              conversationId: conversation._id,
              userId: finalUserId,
              imageBase64,
              prompt
            });
          } else {
            aiResponse = "I couldn't process that image. Please try again.";
          }

          if (aiResponse) {
            const formattedResponse = formatAIResponse(aiResponse, 'telegram');
            await this.sendMessage(peerId, formattedResponse, conversation._id, finalUserId, botToken);
          }
        } catch (err) {
          console.error('[Telegram Direct] Vision AI error:', err.message);
          await this.sendMessage(peerId, "I couldn't process that image. Please try again.", conversation._id, finalUserId);
        } finally {
          if (io) io.to(`user_${finalUserId}`).emit('typing:stop', { conversationId: conversation._id });
        }
      })();
    }

    return savedMsg;
  }

  /**
   * Decoupled Webhook Update Processor
   * Normalizes incoming Telegram update, resolves userId via DB ChannelSession if needed,
   * performs idempotency check using update_id & message_id, and invokes message handlers.
   */
  async processWebhookUpdate(update, explicitUserId = null, explicitBotToken = null) {
    if (!update) return;
    const msg = update.message || update.edited_message;
    if (!msg) return;

    const rawChatId = String(msg.chat.id);
    const providerMessageId = String(msg.message_id);
    const timestamp = msg.date ? msg.date * 1000 : Date.now();

    // Resolve userId & botToken from ChannelSession in DB if explicitUserId / explicitBotToken missing
    let resolvedUserId = explicitUserId;
    let botToken = explicitBotToken;
    let botUsername = '';

    try {
      if (botToken) {
        const activeSessions = await ChannelSession.find({ channel: 'telegram', connected: true }).sort({ updatedAt: -1 });
        for (const s of activeSessions) {
          if (s.botToken && decrypt(s.botToken) === botToken) {
            resolvedUserId = s.userId;
            botUsername = s.botUsername || '';
            break;
          }
        }
      }
      if (!resolvedUserId) {
        const activeSessions = await ChannelSession.find({ channel: 'telegram', connected: true }).sort({ updatedAt: -1 });
        if (activeSessions && activeSessions.length > 0) {
          resolvedUserId = activeSessions[0].userId;
          botToken = activeSessions[0].botToken ? decrypt(activeSessions[0].botToken) : null;
          botUsername = activeSessions[0].botUsername || '';
        }
      }
    } catch (dbErr) {
      console.warn('[Telegram Direct] DB Session lookup warning:', dbErr.message);
    }

    if (!resolvedUserId) {
      console.warn(`[Telegram Direct] No connected user session found for peer ${rawChatId}. Processing with fallback.`);
    }

    // Construct bot-scoped peerId and contactName so different Telegram bots maintain isolated chats in dashboard
    const cleanBotUser = botUsername ? botUsername.replace(/^@/, '') : '';
    const peerId = cleanBotUser ? `${rawChatId}_${cleanBotUser}` : rawChatId;
    const baseContactName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || '';
    const contactName = (baseContactName && cleanBotUser) ? `${baseContactName} (@${cleanBotUser})` : baseContactName;

    // Process Telegram Media vs Text (Additive)
    if (msg.document) {
      console.log(`[Telegram Direct] Processing document upload from ${contactName} (${peerId}): ${msg.document.file_name}`);
      let fileBuffer = null;
      try {
        if (botToken && msg.document.file_id) {
          const fileRes = await axios.get(`https://api.telegram.org/bot${botToken}/getFile`, {
            params: { file_id: msg.document.file_id },
            timeout: 10000
          });
          if (fileRes.data && fileRes.data.ok && fileRes.data.result?.file_path) {
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileRes.data.result.file_path}`;
            const docRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 20000 });
            fileBuffer = Buffer.from(docRes.data);
          }
        }
      } catch (dErr) {
        console.error('[Telegram Document Download Error]:', dErr.message);
      }

      const docTitle = msg.document.file_name || 'Telegram_Document.pdf';
      const caption = msg.caption || `Summarize and explain ${docTitle}`;

      if (fileBuffer && resolvedUserId) {
        try {
          const { ingestDocument } = await import('./documentService.js');
          await ingestDocument({
            userId: resolvedUserId,
            title: docTitle,
            originalName: docTitle,
            fileType: 'pdf',
            fileBuffer
          });
          console.log(`[Telegram Ingestion] Document "${docTitle}" ingested successfully.`);
        } catch (iErr) {
          console.error('[Telegram Ingestion Error]:', iErr.message);
        }
      }

      return await this.handleIncomingMessage(
        peerId,
        caption,
        providerMessageId,
        timestamp,
        contactName,
        true,
        resolvedUserId,
        botToken
      );
    } else if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      const caption = msg.caption || '';
      return await this.handleIncomingPhotoMessage(
        peerId,
        msg.photo,
        caption,
        providerMessageId,
        timestamp,
        contactName,
        true,
        resolvedUserId,
        botToken
      );
    } else if (msg.text) {
      console.log(`[Telegram Direct] Processing message from ${contactName} (${peerId}): "${msg.text.slice(0, 60)}" for user ${resolvedUserId}`);
      return await this.handleIncomingMessage(
        peerId,
        msg.text,
        providerMessageId,
        timestamp,
        contactName,
        true,
        resolvedUserId,
        botToken
      );
    }
  }

  // ── Adaptive Listener (Webhook or Polling) ──────────────────────────────────
  async initTelegramListeners() {
    console.log('[Telegram Direct] Initializing direct Telegram listeners...');
    try {
      const activeSessions = await ChannelSession.find({ channel: 'telegram', connected: true }).sort({ updatedAt: -1 });
      
      // Deduplicate active sessions by botToken to avoid spawning competing polling loops for the same bot
      const uniqueBotSessions = new Map();
      for (const session of activeSessions) {
        if (!session.botToken) continue;
        const botToken = decrypt(session.botToken);
        if (!botToken) continue;
        if (!uniqueBotSessions.has(botToken)) {
          uniqueBotSessions.set(botToken, session);
        }
      }

      for (const [botToken, session] of uniqueBotSessions.entries()) {
        const appUrl = process.env.APP_URL;
        const isHttpsUrl = appUrl && appUrl.startsWith('https://') && !appUrl.includes('localhost') && !appUrl.includes('127.0.0.1');

        if (isHttpsUrl && process.env.TELEGRAM_POLLING !== 'true') {
          // Register Webhook with user-scoped path
          this.stopPollingForUser(session.userId, botToken);
          const webhookUrl = `${appUrl.replace(/\/+$/, '')}/api/channels/telegram/webhook/${session.userId}`;
          console.log(`[Telegram Direct] Registering webhook for user ${session.userId}: ${webhookUrl}`);
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/setWebhook`, { url: webhookUrl }, { timeout: 10000 });
            console.log(`[Telegram Direct] Webhook registered successfully for user ${session.userId}`);
          } catch (webhookErr) {
            console.warn(`[Telegram Direct] Webhook registration warning for user ${session.userId}: ${webhookErr.message}`);
          }
        } else {
          console.log(`[Telegram Direct] Operating in polling mode for bot (@${session.botUsername || session.userId})`);
          this.startPollingForUser(session.userId, botToken);
        }
      }
    } catch (err) {
      console.error('[Telegram Direct] Error initializing listeners:', err.message);
    }
  }

  async startPollingForUser(userId, botToken) {
    if (!botToken) return;
    const pollingKey = String(botToken);

    if (pollingTimers.has(pollingKey)) {
      console.log(`[Telegram Direct] Replacing existing polling timer for bot token`);
      this.stopPollingForUser(userId, botToken);
    }

    console.log(`[Telegram Direct] Starting single long-polling listener for bot (user ${userId})`);

    // Delete active webhook first so Telegram allows getUpdates long-polling
    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { drop_pending_updates: false }, { timeout: 10000 });
      console.log(`[Telegram Direct] Cleared active webhook for polling (user ${userId})`);
    } catch (delErr) {
      /* ignore non-critical deleteWebhook error */
    }

    let offset = 0;
    let nextDelay = 1500;

    const poll = async () => {
      try {
        const res = await axios.get(`https://api.telegram.org/bot${botToken}/getUpdates`, {
          params: { offset, timeout: 10 }
        });

        if (res.data && res.data.ok && Array.isArray(res.data.result)) {
          nextDelay = 1500;
          for (const update of res.data.result) {
            offset = update.update_id + 1;
            await this.processWebhookUpdate(update, userId, botToken);
          }
        }
      } catch (err) {
        const desc = err.response?.data?.description || err.message;
        if (desc && desc.includes('Conflict')) {
          console.warn(`[Telegram Direct] Polling conflict detected (previous session ending or webhook active). Retrying deleteWebhook and polling in 2s...`);
          axios.post(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { drop_pending_updates: false }).catch(() => {});
          nextDelay = 2000;
        } else {
          console.error('[Telegram Direct] Polling error:', desc);
          nextDelay = 4000;
        }
      } finally {
        if (pollingTimers.has(pollingKey)) {
          const timer = setTimeout(poll, nextDelay);
          pollingTimers.set(pollingKey, timer);
        }
      }
    };

    const timer = setTimeout(poll, 500);
    pollingTimers.set(pollingKey, timer);
  }

  stopPollingForUser(userId, botToken = null) {
    if (botToken) {
      const timer = pollingTimers.get(String(botToken));
      if (timer) {
        clearTimeout(timer);
        pollingTimers.delete(String(botToken));
        console.log(`[Telegram Direct] Stopped polling listener for bot`);
      }
    } else {
      // Clear all timers as fallback
      for (const [key, timer] of pollingTimers.entries()) {
        clearTimeout(timer);
        pollingTimers.delete(key);
      }
      console.log(`[Telegram Direct] Cleared polling listeners`);
    }
  }
}

export default new TelegramService();

