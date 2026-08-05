import Conversation from '../models/Conversation.js';
import ContactService from './ContactService.js';
import { getSocketIO } from '../socket/index.js';
import User from '../models/User.js';

class ConversationService {
  async getOrCreateConversation({ channel, peerId, userId, contactData = {} }) {
    console.log(`[ConversationService] getOrCreateConversation channel: ${channel}, peerId: ${peerId}, userId: ${userId}`);
    
    // Resolve fallback user if userId is not explicitly supplied (e.g. legacy webhooks)
    if (!userId) {
      const firstUser = await User.findOne();
      userId = firstUser ? firstUser._id : null;
    }

    let conversation = await Conversation.findOne({ userId, channel, peerId });
    
    const contact = await ContactService.getOrCreateContact({
      channel,
      phone: channel === 'whatsapp' ? peerId : undefined,
      telegramId: channel === 'telegram' ? peerId : undefined,
      name: contactData.name,
      profilePhoto: contactData.profilePhoto,
      userId
    });

    if (!conversation) {
      console.log(`[ConversationService] Conversation not found, creating new one`);
      conversation = await Conversation.create({
        userId,
        title: contact.name,
        contactId: contact._id,
        channel,
        peerId,
        status: 'active',
        lastMessage: '',
        unreadCount: 0
      });

      const io = getSocketIO();
      if (io) {
        io.to(`user_${userId}`).emit('conversation:new', conversation);
      }
    } else {
      if (conversation.title !== contact.name || !conversation.contactId) {
        conversation.title = contact.name;
        conversation.contactId = contact._id;
        await conversation.save();
      }
    }

    return conversation;
  }

  async updateConversationDetails(conversationId, lastMessageText, unreadIncrement = 0) {
    console.log(`[ConversationService] Updating conversation details for ${conversationId}`);
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return null;

    conversation.lastMessage = lastMessageText;
    conversation.lastMessageAt = new Date();
    if (unreadIncrement > 0) {
      conversation.unreadCount = (conversation.unreadCount || 0) + unreadIncrement;
    }

    await conversation.save();

    const io = getSocketIO();
    if (io) {
      io.to(`user_${conversation.userId}`).emit('conversation:update', conversation);
    }

    return conversation;
  }

  async clearUnreadCount(conversationId) {
    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { unreadCount: 0 },
      { new: true }
    );
    if (conversation) {
      const io = getSocketIO();
      if (io) {
        io.to(`user_${conversation.userId}`).emit('conversation:update', conversation);
      }
    }
    return conversation;
  }

  async getConversations(channel, userId) {
    const filter = {};
    if (channel) {
      filter.channel = channel;
    }
    if (userId) {
      filter.userId = userId;
    }
    return Conversation.find(filter)
      .populate('contactId')
      .sort({ lastMessageAt: -1 });
  }
}

export default new ConversationService();
