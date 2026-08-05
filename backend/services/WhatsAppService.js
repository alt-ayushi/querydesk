/**
 * WhatsAppService.js
 *
 * Direct WhatsApp Web Service via Baileys (No OpenClaw dependency).
 *   - Inbound: Baileys messages.upsert → save DB → emit Socket.IO → call generateAIResponseForConversation → reply via Baileys
 *   - Outbound (dashboard): save DB → deliver via Baileys active socket
 */
import { generateAIResponseForConversation } from './aiService.js';
import ConversationService from './ConversationService.js';
import MessageRepository from '../repositories/MessageRepository.js';
import ChannelSession from '../models/ChannelSession.js';
import { getBaileysSocket } from './channelConnectionService.js';
import { getSocketIO } from '../socket/index.js';

export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

class WhatsAppService {

  normalizePhoneNumber(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  // ── Dashboard → WhatsApp Mobile ────────────────────────────────────────────
  async sendMessage(peerId, text, conversationId, userId) {
    console.log(`[WhatsApp Direct] Dashboard → mobile: ${peerId}, user: ${userId}`);
    const io = getSocketIO();

    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'whatsapp', peerId, userId
    });

    const savedMsg = await MessageRepository.create({
      userId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'whatsapp',
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
      const sock = getBaileysSocket(userId);
      if (!sock) {
        throw new Error('WhatsApp is not connected for this user.');
      }

      // Format WhatsApp JID: e.g. 1234567890@s.whatsapp.net
      const jid = peerId.includes('@') ? peerId : `${peerId.replace(/\D/g, '')}@s.whatsapp.net`;
      const sentResult = await sock.sendMessage(jid, { text });

      savedMsg.status = 'sent';
      if (sentResult && sentResult.key && sentResult.key.id) {
        savedMsg.providerMessageId = sentResult.key.id;
      }
      await savedMsg.save();

      if (io) io.to(`user_${userId}`).emit('message:update', savedMsg);
      return savedMsg;

    } catch (err) {
      console.error(`[WhatsApp Direct] Delivery failed:`, err.message);
      savedMsg.status = 'failed';
      await savedMsg.save();
      if (io) io.to(`user_${userId}`).emit('message:update', savedMsg);
      throw err;
    }
  }

  // ── Inbound WhatsApp → AI → Outbound Direct Reply ─────────────────────────
  async handleIncomingMessage(peerId, text, providerMessageId, timestamp, contactName = '', isUser = true, userId = null, isFromMe = false) {
    const io = getSocketIO();
    console.log(`[WhatsApp Direct] Incoming [isUser=${isUser}] from ${peerId}: "${text.slice(0, 80)}" for user ${userId}`);

    // ── 0. Strict Whitelist Filter ("Message Yourself" chat ONLY) ─────────────
    const sessionQuery = userId ? { userId, channel: 'whatsapp' } : { channel: 'whatsapp', connected: true };
    const activeSession = await ChannelSession.findOne(sessionQuery);
    const allowedPhone = (activeSession && activeSession.phoneNumber && activeSession.phoneNumber !== 'null')
      ? activeSession.phoneNumber
      : process.env.WHATSAPP_ALLOWED_NUMBER;

    const normalizedAllowed = normalizePhoneNumber(allowedPhone);
    const normalizedTarget = normalizePhoneNumber(peerId);

    const isSelfTarget = Boolean(
      (normalizedAllowed && normalizedTarget && normalizedTarget === normalizedAllowed) ||
      (allowedPhone && String(peerId).includes(allowedPhone)) ||
      (normalizedAllowed && String(peerId).includes(normalizedAllowed))
    );

    if (normalizedAllowed && !isSelfTarget) {
      console.log(`[WhatsApp Direct] Ignored message from non-self chat target: ${peerId} (normalized: "${normalizedTarget}"). Allowed self-chat: "${normalizedAllowed}"`);
      return null;
    }

    if (normalizedAllowed) {
      peerId = activeSession?.phoneNumber || allowedPhone;
    }

    // ── 1. Resolve conversation ───────────────────────────────────────────────
    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'whatsapp',
      peerId,
      userId,
      contactData: { name: contactName }
    });

    const finalUserId = userId || conversation.userId;

    // ── 2. Deduplicate ────────────────────────────────────────────────────────
    if (providerMessageId) {
      const existing = await MessageRepository.findByProviderMessageId(String(providerMessageId));
      if (existing) {
        console.log(`[WhatsApp Direct] Duplicate message ${providerMessageId}, skipping`);
        return existing;
      }
    }

    if (isFromMe || !isUser) {
      const MessageModel = (await import('../models/Message.js')).default;
      const lastMsg = await MessageModel.findOne({ conversationId: conversation._id }).sort({ timestamp: -1 });
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.text === text) {
        console.log(`[WhatsApp Direct] Skipping self-reply loop for assistant text`);
        return lastMsg;
      }
    }

    // ── 3. Save message to DB ────────────────────────────────────────────────
    const savedMsg = await MessageRepository.create({
      userId: finalUserId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'whatsapp',
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

          // Request AI response string from decoupled AI layer
          const aiResponse = await generateAIResponseForConversation({
            conversationId: conversation._id,
            userId: finalUserId
          });

          if (aiResponse) {
            console.log(`[WhatsApp Direct] AI response generated: "${aiResponse.slice(0, 50)}..."`);
            // Deliver response text via channel transport
            await this.sendMessage(peerId, aiResponse, conversation._id, finalUserId);
          }
        } catch (err) {
          console.error('[WhatsApp Direct] AI automatic responder error:', err.message);
        } finally {
          if (io) io.to(`user_${finalUserId}`).emit('typing:stop', { conversationId: conversation._id });
        }
      })();
    }

    return savedMsg;
  }

  // ── Inbound WhatsApp Image → Vision AI ──────────────────────────────────────
  async handleIncomingImageMessage(peerId, imageBase64, text, providerMessageId, timestamp, contactName = '', isUser = true, userId = null, isFromMe = false) {
    const io = getSocketIO();
    console.log(`[WhatsApp Direct] Incoming Image [isUser=${isUser}] from ${peerId}: "${text.slice(0, 80)}" for user ${userId}`);

    // ── 0. Strict Whitelist Filter ("Message Yourself" chat ONLY) ─────────────
    const sessionQuery = userId ? { userId, channel: 'whatsapp' } : { channel: 'whatsapp', connected: true };
    const activeSession = await ChannelSession.findOne(sessionQuery);
    const allowedPhone = (activeSession && activeSession.phoneNumber && activeSession.phoneNumber !== 'null')
      ? activeSession.phoneNumber
      : process.env.WHATSAPP_ALLOWED_NUMBER;

    const normalizedAllowed = normalizePhoneNumber(allowedPhone);
    const normalizedTarget = normalizePhoneNumber(peerId);

    const isSelfTarget = Boolean(
      (normalizedAllowed && normalizedTarget && normalizedTarget === normalizedAllowed) ||
      (allowedPhone && String(peerId).includes(allowedPhone)) ||
      (normalizedAllowed && String(peerId).includes(normalizedAllowed))
    );

    if (normalizedAllowed && !isSelfTarget) {
      console.log(`[WhatsApp Direct] Ignored image message from non-self chat target: ${peerId}`);
      return null;
    }

    if (normalizedAllowed) {
      peerId = activeSession?.phoneNumber || allowedPhone;
    }

    // ── 1. Resolve conversation ───────────────────────────────────────────────
    const conversation = await ConversationService.getOrCreateConversation({
      channel: 'whatsapp',
      peerId,
      userId,
      contactData: { name: contactName }
    });

    const finalUserId = userId || conversation.userId;

    // ── 2. Deduplicate ────────────────────────────────────────────────────────
    if (providerMessageId) {
      const existing = await MessageRepository.findByProviderMessageId(String(providerMessageId));
      if (existing) return existing;
    }

    // ── 3. Save user message to DB ────────────────────────────────────────────
    const prompt = text || 'Describe this image.';
    const savedMsg = await MessageRepository.create({
      userId: finalUserId,
      conversationId: conversation._id,
      contactId: conversation.contactId,
      channel: 'whatsapp',
      role: isUser ? 'user' : 'assistant',
      direction: isUser ? 'inbound' : 'outbound',
      messageType: 'image',
      imageUrl: imageBase64 || undefined,
      text: prompt,
      status: isUser ? 'delivered' : 'sent',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      providerMessageId: providerMessageId ? String(providerMessageId) : undefined
    });

    await ConversationService.updateConversationDetails(conversation._id, `📷 ${prompt}`, isUser ? 1 : 0);

    if (io) io.to(`user_${finalUserId}`).emit('message:new', savedMsg);

    // ── 4. Trigger Vision AI turn ─────────────────────────────────────────────
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
            console.log(`[WhatsApp Direct] Vision AI response generated: "${aiResponse.slice(0, 50)}..."`);
            await this.sendMessage(peerId, aiResponse, conversation._id, finalUserId);
          }
        } catch (err) {
          console.error('[WhatsApp Direct] Vision AI error:', err.message);
          await this.sendMessage(peerId, "I couldn't process that image. Please try again.", conversation._id, finalUserId);
        } finally {
          if (io) io.to(`user_${finalUserId}`).emit('typing:stop', { conversationId: conversation._id });
        }
      })();
    }

    return savedMsg;
  }
}

export default new WhatsAppService();

