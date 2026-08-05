import Contact from '../models/Contact.js';

class ContactRepository {
  async findById(id) {
    return Contact.findById(id);
  }

  async findByChannelId(channel, peerId, userId) {
    const query = { channel };
    if (userId) query.userId = userId;
    
    if (channel === 'whatsapp') {
      query.phone = peerId;
      return Contact.findOne(query);
    } else if (channel === 'telegram') {
      query.telegramId = peerId;
      return Contact.findOne(query);
    }
    return null;
  }

  async create(contactData) {
    return Contact.create(contactData);
  }

  async update(id, updateData) {
    return Contact.findByIdAndUpdate(id, updateData, { new: true });
  }

  async findAll() {
    return Contact.find().sort({ createdAt: -1 });
  }
}

export default new ContactRepository();
