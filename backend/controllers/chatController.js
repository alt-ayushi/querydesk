import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { generateAIResponseStream } from '../services/aiService.js';
import { getSocketIO } from '../socket/index.js';

export const handleWebChat = async (req, res) => {
  try {
    const { message, conversationId, image } = req.body;
    if (!message && !image) return res.status(400).json({ error: 'Message content or image is required' });

    console.log('[Flow] Incoming Message');

    let conversation;
    if (conversationId) conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });

    const io = getSocketIO();

    if (!conversation) {
      const initialText = message || 'Image Query';
      conversation = await Conversation.create({
        userId: req.user._id,
        title: initialText.slice(0, 30) + (initialText.length > 30 ? '...' : ''),
        channel: 'web',
        peerId: 'web-' + Math.random().toString(36).substr(2, 9),
        status: 'active'
      });
      if (io) {
        io.to(`user_${req.user._id}`).emit('conversation:new', conversation);
        console.log('[Flow] Socket Event Emitted');
      }
    }
    console.log('[Flow] Conversation Loaded');

    // ── Image Handling Path ──
    if (image) {
      const userMsg = await Message.create({
        userId: req.user._id,
        conversationId: conversation._id,
        text: message || 'Describe this image.',
        messageType: 'image',
        imageUrl: image,
        role: 'user',
        direction: 'inbound',
        channel: 'web',
        timestamp: new Date(),
        status: 'read'
      });

      conversation.lastMessage = message ? `📷 ${message}` : '📷 [Image]';
      conversation.lastMessageAt = userMsg.timestamp;
      await conversation.save();

      if (io) {
        io.to(`user_${req.user._id}`).emit('message:new', userMsg);
        io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
        io.to(`user_${req.user._id}`).emit('typing:start', { conversationId: conversation._id });
      }

      const { generateVisionAIResponseForConversation } = await import('../services/aiService.js');
      const { formatAIResponse } = await import('../utils/formatResponse.js');

      let visionReply = '';
      try {
        const rawReply = await generateVisionAIResponseForConversation({
          conversationId: conversation._id,
          userId: req.user._id,
          imageBase64: image,
          prompt: message || 'Describe this image.'
        });

        console.log('\n[IMAGE 6/8]\nFormatting');
        visionReply = formatAIResponse(rawReply, 'web');
      } catch (err) {
        console.error('[IMAGE Error] Vision pipeline failed:');
        console.error(err.stack || err);
        visionReply = "I couldn't process that image. Please try again.";
      }

      console.log('\n[IMAGE 7/8]\nDatabase saved');
      const assistantMsg = await Message.create({
        userId: req.user._id,
        conversationId: conversation._id,
        text: visionReply,
        role: 'assistant',
        direction: 'outbound',
        channel: 'web',
        timestamp: new Date(),
        status: 'read'
      });

      conversation.lastMessage = visionReply;
      conversation.lastMessageAt = assistantMsg.timestamp;
      await conversation.save();

      if (io) {
        io.to(`user_${req.user._id}`).emit('typing:stop', { conversationId: conversation._id });
        io.to(`user_${req.user._id}`).emit('message:new', assistantMsg);
        io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
      }

      console.log('\n[IMAGE 8/8]\nReply sent');
      return res.json({ conversationId: conversation._id, userMessage: userMsg, assistantMessage: assistantMsg, reply: visionReply });
    }

    // Save user message
    const userMsg = await Message.create({
      userId: req.user._id,
      conversationId: conversation._id,
      text: message,
      role: 'user',
      direction: 'inbound',
      channel: 'web',
      timestamp: new Date(),
      status: 'read'
    });

    conversation.lastMessage = message;
    conversation.lastMessageAt = userMsg.timestamp;
    await conversation.save();

    if (io) {
      io.to(`user_${req.user._id}`).emit('message:new', userMsg);
      io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
      io.to(`user_${req.user._id}`).emit('typing:start', { conversationId: conversation._id });
      console.log('[Flow] Socket Event Emitted');
    }

    // Load history from DB for context
    const historyLogs = await Message.find({ conversationId: conversation._id, userId: req.user._id })
      .sort({ timestamp: 1 })
      .limit(20);
    console.log('[Flow] History Loaded');

    const history = historyLogs.map(h => ({
      role: h.role,
      text: h.text || h.message || ''
    }));

    // SSE stream response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log('[Flow] Sending Reply');
    res.write(`data: ${JSON.stringify({ conversationId: conversation._id, userMessage: userMsg })}\n\n`);

    let fullReply = '';

    try {
      await generateAIResponseStream(history, (chunk) => {
        fullReply += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });

      console.log('[Flow] Saving Assistant Message');
      const assistantMsg = await Message.create({
        userId: req.user._id,
        conversationId: conversation._id,
        text: fullReply,
        role: 'assistant',
        direction: 'outbound',
        channel: 'web',
        timestamp: new Date(),
        status: 'read'
      });

      conversation.lastMessage = fullReply;
      conversation.lastMessageAt = assistantMsg.timestamp;
      await conversation.save();

      if (io) {
        io.to(`user_${req.user._id}`).emit('typing:stop', { conversationId: conversation._id });
        io.to(`user_${req.user._id}`).emit('message:new', assistantMsg);
        io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
        console.log('[Flow] Socket Event Emitted');
      }

      console.log('[Flow] Sending Reply');
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[Flow] Completed');

    } catch (aiErr) {
      console.error('[WebChat] Stream error:', aiErr);
      res.write(`data: ${JSON.stringify({ error: aiErr.message })}\n\n`);
      console.log('[Flow] Sending Reply');
      res.write('data: [DONE]\n\n');
      res.end();
      if (io) {
        io.to('web').emit('typing:stop', { conversationId: conversation._id });
        console.log('[Flow] Socket Event Emitted');
      }
      console.log('[Flow] Completed');
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getConversations = async (req, res) => {
  try {
    const { channel } = req.query;
    const filter = { userId: req.user._id };
    if (channel) filter.channel = channel;
    // Exclude known mock/test peerIds at the database level
    filter.peerId = { $ne: '987654321' };

    const conversations = await Conversation.find(filter)
      .populate('contactId')
      .sort({ lastMessageAt: -1 });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    // Scoped check
    const conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found or access denied' });

    const messages = await Message.find({ conversationId, userId: req.user._id }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const renameConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found or access denied' });

    conversation.title = title;
    await conversation.save();

    const io = getSocketIO();
    if (io) io.to(`user_${req.user._id}`).emit('conversation:update', conversation);

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found or access denied' });

    const channel = conversation.channel;
    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversationId, userId: req.user._id });

    const io = getSocketIO();
    if (io) io.to(`user_${req.user._id}`).emit('conversation:delete', { conversationId, channel });

    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
