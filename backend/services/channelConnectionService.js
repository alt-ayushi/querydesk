import path from 'path';
import fs from 'fs';
import axios from 'axios';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import ChannelSession from '../models/ChannelSession.js';
import { getSocketIO } from '../socket/index.js';

// Map of active Baileys WhatsApp sockets per userId
const activeWASockets = new Map();

/**
 * Abstracted Baileys authentication storage provider.
 * Reads/writes credentials to `./auth_info_baileys/user_<userId>`.
 * Can be swapped for Redis/S3/MongoDB persistence adapter in the future.
 */
export async function getBaileysAuthState(userId) {
  const baseDir = process.env.BAILEYS_AUTH_DIR || './auth_info_baileys';
  const userDir = path.join(baseDir, `user_${userId}`);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return await useMultiFileAuthState(userDir);
}

/**
 * Gets the active Baileys WhatsApp socket for a user.
 * @param {string} userId
 */
export function getBaileysSocket(userId) {
  return activeWASockets.get(String(userId)) || null;
}

/**
 * Starts WhatsApp login for a user using native Baileys.
 * Generates QR code and streams data URL via Socket.IO.
 * Binds messages.upsert listener to WhatsAppService.
 * @param {string} userId
 */
export async function startWhatsAppLogin(userId) {
  const ts = () => new Date().toISOString();
  console.log(`\n>>> [TIMELINE ${ts()}] startWhatsAppLogin ENTERED for user: ${userId}`);

  // Only close socket if active WASocket exists in map (do NOT call if starting fresh)
  if (activeWASockets.has(String(userId))) {
    console.log(`[TIMELINE ${ts()}] Active socket found for user ${userId}, closing existing socket...`);
    stopWhatsAppLogin(userId);
  }

  try {
    const baseDir = process.env.BAILEYS_AUTH_DIR || './auth_info_baileys';
    const userDir = path.join(baseDir, `user_${userId}`);

    console.log(`[TIMELINE ${ts()}] Loading Baileys auth state from: ${userDir}`);
    const { state, saveCreds } = await getBaileysAuthState(userId);

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    console.log(`[TIMELINE ${ts()}] Initializing makeWASocket (version: ${version.join('.')})...`);
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['QueryDesk', 'Desktop', '1.0.0'],
      syncFullHistory: false,
      defaultQueryTimeoutMs: undefined
    });

    activeWASockets.set(String(userId), sock);
    console.log(`[TIMELINE ${ts()}] Socket saved in activeWASockets map (count: ${activeWASockets.size})`);

    sock.ev.on('creds.update', (creds) => {
      console.log(`\n>>> [TIMELINE ${ts()}] EVENT creds.update FIRED`);
      saveCreds(creds);
      if (fs.existsSync(userDir)) {
        console.log(`[TIMELINE ${ts()}] userDir files after saveCreds:`, fs.readdirSync(userDir));
      }
    });

    sock.ev.on('connection.update', async (update) => {
      console.log(`\n>>> [TIMELINE ${ts()}] EVENT connection.update FIRED:`, JSON.stringify(update, (k, v) => k === 'qr' ? (v ? '[QR]' : undefined) : v));

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[TIMELINE ${ts()}] QR CODE DETECTED in connection.update`);
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          await ChannelSession.findOneAndUpdate(
            { userId, channel: 'whatsapp' },
            { qrCode: qrDataUrl, connected: false },
            { upsert: true, new: true }
          );

          const io = getSocketIO();
          if (io) {
            console.log(`[TIMELINE ${ts()}] EMITTING channel:qr via Socket.IO...`);
            io.to(`user_${userId}`).emit('channel:qr', { channel: 'whatsapp', qrCode: qrDataUrl });
          }
        } catch (err) {
          console.error(`[TIMELINE ${ts()}] ERROR generating QR:`, err);
        }
      }

      if (connection === 'open') {
        console.log(`\n=================== [TIMELINE ${ts()}] WA CONNECTION OPENED SUCCESSFULLY! ===================`);
        const userPhone = sock.user?.id ? sock.user.id.split(':')[0] : null;

        await ChannelSession.findOneAndUpdate(
          { userId, channel: 'whatsapp' },
          { qrCode: null, connected: true, phoneNumber: userPhone },
          { upsert: true, new: true }
        );

        const io = getSocketIO();
        if (io) {
          io.to(`user_${userId}`).emit('channel:connected', { channel: 'whatsapp', phoneNumber: userPhone });
        }
      }

      if (connection === 'close') {
        console.log(`\n=================== [TIMELINE ${ts()}] WA CONNECTION CLOSED ===================`);
        console.log(`[TIMELINE ${ts()}] lastDisconnect object:`, JSON.stringify(lastDisconnect));

        const statusCode = (lastDisconnect?.error?.error || lastDisconnect?.error)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
        const isIntentionalClose = !lastDisconnect || (lastDisconnect.error === undefined && !statusCode);

        // Only reconnect on actual server-side connection drops, not intentional stops or logouts
        const shouldReconnect = !isIntentionalClose && !isLoggedOut;
        console.log(`[TIMELINE ${ts()}] RECONNECT CHECK: statusCode=${statusCode}, isLoggedOut=${isLoggedOut}, isIntentionalClose=${isIntentionalClose}, shouldReconnect=${shouldReconnect}`);

        if (shouldReconnect) {
          console.log(`[TIMELINE ${ts()}] SCHEDULING RECONNECT in 3000ms...`);
          setTimeout(() => {
            console.log(`[TIMELINE ${ts()}] RECONNECT TIMER EXPIRED, calling startWhatsAppLogin...`);
            startWhatsAppLogin(userId);
          }, 3000);
        } else {
          console.log(`[TIMELINE ${ts()}] NOT RECONNECTING. Removing user ${userId} from activeWASockets...`);
          activeWASockets.delete(String(userId));

          if (isLoggedOut && fs.existsSync(userDir)) {
            console.log(`[TIMELINE ${ts()}] Logged out (401). Purging auth directory...`);
            fs.rmSync(userDir, { recursive: true, force: true });
          }

          await ChannelSession.findOneAndUpdate(
            { userId, channel: 'whatsapp' },
            { qrCode: null, connected: false },
            { upsert: true, new: true }
          );

          const io = getSocketIO();
          if (io) {
            io.to(`user_${userId}`).emit('channel:disconnected', { channel: 'whatsapp' });
          }
        }
      }
    });

    // Handle inbound WhatsApp messages directly via Baileys socket listener
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      const WhatsAppModule = await import('./WhatsAppService.js');
      const WhatsAppService = WhatsAppModule.default;
      const normalizePhoneNumber = (phone) => {
        if (typeof WhatsAppModule.normalizePhoneNumber === 'function') return WhatsAppModule.normalizePhoneNumber(phone);
        if (typeof WhatsAppService.normalizePhoneNumber === 'function') return WhatsAppService.normalizePhoneNumber(phone);
        const digits = String(phone || '').replace(/\D/g, '');
        return digits.length >= 10 ? digits.slice(-10) : digits;
      };
      const ChannelSession = (await import('../models/ChannelSession.js')).default;

      // Resolve connected user session phone number
      const session = await ChannelSession.findOne({ userId, channel: 'whatsapp' });
      const ownerPhone = (session && session.phoneNumber && session.phoneNumber !== 'null') 
        ? session.phoneNumber 
        : process.env.WHATSAPP_ALLOWED_NUMBER;

      const normalizedOwner = normalizePhoneNumber(ownerPhone);
      const userLid = sock.user?.lid || '';
      const userIdJid = sock.user?.id || '';

      const getCleanJidBase = (jid) => {
        if (!jid) return '';
        const beforeAt = String(jid).split('@')[0];
        return beforeAt.split(':')[0];
      };

      const userLidBase = getCleanJidBase(userLid);
      const userIdBase = getCleanJidBase(userIdJid);

      for (const msg of m.messages) {
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid || '';
        const isGroup = remoteJid.endsWith('@g.us');
        const isStatus = remoteJid.includes('status@broadcast');
        const isFromMe = !!msg.key.fromMe;
        const peerId = remoteJid.split('@')[0] || '';
        const pushName = msg.pushName || '';

        console.log(`\n=================== [WA FILTER AUDIT] ===================`);
        console.log(`[TIMESTAMP]: ${new Date().toISOString()}`);
        console.log(`[REMOTE JID]: ${remoteJid}`);
        console.log(`[PEER ID]: ${peerId}`);
        console.log(`[FROM ME]: ${isFromMe}`);
        console.log(`[IS GROUP]: ${isGroup}`);
        console.log(`[IS STATUS]: ${isStatus}`);
        console.log(`[MSG ID]: ${msg.key.id}`);

        // 1. Ignore Status & Group messages
        if (isStatus || isGroup) {
          console.log(`[FILTER REJECTED]: Ignored status or group message (${remoteJid})`);
          continue;
        }

        // 2. Strict Self-Chat Filter ("Message Yourself" chat ONLY)
        const remoteJidBase = getCleanJidBase(remoteJid);
        const normalizedTarget = normalizePhoneNumber(peerId);

        const isSelfByPhone = Boolean(normalizedOwner && normalizedTarget && normalizedTarget === normalizedOwner);
        const isSelfByLid = Boolean(userLidBase && remoteJidBase && remoteJidBase === userLidBase);
        const isSelfById = Boolean(userIdBase && remoteJidBase && remoteJidBase === userIdBase);

        const isSelfChat = isSelfByPhone || isSelfByLid || isSelfById;

        if (!isSelfChat) {
          console.log(`[FILTER REJECTED]: Chat target ${peerId} (${remoteJid}) is NOT your personal self-chat. Discarding.`);
          continue;
        }

        // 3. Handle WhatsApp Image Message
        if (msg.message.imageMessage) {
          console.log(`[FILTER ACCEPTED]: Self-chat image message from ${peerId} passed all filters. Downloading image media...`);
          let imageBase64 = null;
          try {
            const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: console, reconnect: async () => sock });
            if (buffer) {
              imageBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            }
          } catch (err) {
            console.error('[WA Media Download Error]:', err.message);
          }

          const caption = msg.message.imageMessage.caption || '';
          const prompt = caption || 'Describe this image.';

          await WhatsAppService.handleIncomingImageMessage(
            ownerPhone || userIdBase || peerId,
            imageBase64,
            prompt,
            msg.key.id,
            msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
            pushName || 'Self',
            true,
            userId,
            isFromMe
          );
          continue;
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text) {
          console.log(`[FILTER REJECTED]: Message has no plain text content (media/system).`);
          continue;
        }

        console.log(`[FILTER ACCEPTED]: Self-chat message from ${peerId} passed all filters. Forwarding to AI pipeline.`);
        console.log(`[TEXT]: "${text.slice(0, 100)}"`);

        await WhatsAppService.handleIncomingMessage(
          ownerPhone || userIdBase || peerId,
          text,
          msg.key.id,
          msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now(),
          pushName || 'Self',
          true,
          userId,
          isFromMe
        );
      }
    });

  } catch (err) {
    console.error(`[TIMELINE ${ts()}] ERROR in startWhatsAppLogin:`, err);
  }
}

/**
 * Restores active WhatsApp Baileys sessions for connected users on server startup.
 */
export async function initWhatsAppSessions() {
  console.log('[WA Direct Connection] Restoring active WhatsApp sessions...');
  try {
    const activeSessions = await ChannelSession.find({ channel: 'whatsapp', connected: true });
    for (const session of activeSessions) {
      startWhatsAppLogin(session.userId);
    }
  } catch (err) {
    console.error('[WA Direct Connection] Error restoring sessions:', err.message);
  }
}

/**
 * Stops/terminates active WhatsApp socket for a user.
 */
export function stopWhatsAppLogin(userId) {
  const sock = activeWASockets.get(String(userId));
  if (sock) {
    console.log(`[WA Direct Connection] Closing active socket for user: ${userId}`);
    try { sock.end(undefined); } catch { /* ignore */ }
    activeWASockets.delete(String(userId));
  }
}

/**
 * Disconnects and logs out WhatsApp channel for a user.
 */
export async function logoutWhatsAppChannel(userId) {
  console.log(`[WA Direct Connection] Disconnecting WhatsApp channel for user: ${userId}`);
  stopWhatsAppLogin(userId);

  // Clean local auth store
  const baseDir = process.env.BAILEYS_AUTH_DIR || './auth_info_baileys';
  const userDir = path.join(baseDir, `user_${userId}`);
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }

  await ChannelSession.findOneAndUpdate(
    { userId, channel: 'whatsapp' },
    { connected: false, qrCode: null, phoneNumber: null }
  );
}

/**
 * Connects Telegram Bot channel by directly validating token against Telegram Bot API.
 * @param {string} userId - Authenticated user ID
 * @param {string} token - Telegram Bot Token
 */
export async function connectTelegramBot(userId, token) {
  console.log(`[TG Direct Connection] Validating Telegram bot token for user: ${userId}`);
  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 });
    if (!res.data || !res.data.ok) {
      throw new Error(res.data?.description || 'Invalid Telegram Bot Token');
    }

    const botInfo = res.data.result;
    console.log(`[TG Direct Connection] Telegram Bot validated successfully: @${botInfo.username}`);

    // Update global active bot username
    global.defaultTelegramBotUsername = botInfo.username;

    // Trigger direct listener initialization if active
    const TelegramService = (await import('./TelegramService.js')).default;
    TelegramService.initTelegramListeners().catch(err => console.error('[TG Direct Listener] Init error:', err.message));

    return botInfo;
  } catch (err) {
    console.error(`[TG Direct Connection] Validation failed:`, err.message);
    throw new Error(err.response?.data?.description || err.message || 'Failed to connect Telegram Bot');
  }
}

/**
 * Removes Telegram bot account.
 * @param {string} userId - Authenticated user ID
 */
export async function removeTelegramBotChannel(userId) {
  console.log(`[TG Direct Connection] Disconnecting Telegram account for user: ${userId}`);
  try {
    const TelegramService = (await import('./TelegramService.js')).default;
    TelegramService.stopPollingForUser(userId);
  } catch (err) {
    console.error('[TG Direct Connection] Error stopping listener:', err.message);
  }
}


