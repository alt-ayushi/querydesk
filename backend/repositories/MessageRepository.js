import Message from '../models/Message.js';

class MessageRepository {
  async findById(id) {
    return Message.findById(id);
  }

  async findByConversationId(conversationId, limit = 100) {
    return Message.find({ conversationId })
      .sort({ timestamp: 1 })
      .limit(limit);
  }

  async findByProviderMessageId(providerMessageId) {
    return Message.findOne({ providerMessageId });
  }

  async create(messageData) {
    return Message.create(messageData);
  }

  async updateStatus(id, status) {
    return Message.findByIdAndUpdate(id, { status }, { new: true });
  }

  async updateByProviderMessageId(providerMessageId, updateData) {
    return Message.findOneAndUpdate({ providerMessageId }, updateData, { new: true });
  }
}

export default new MessageRepository();
