import ContactRepository from '../repositories/ContactRepository.js';
import User from '../models/User.js';

class ContactService {
  async getOrCreateContact({ name, phone, telegramId, channel, profilePhoto, userId }) {
    console.log(`[ContactService] getOrCreateContact channel: ${channel}, phone: ${phone}, telegramId: ${telegramId}, userId: ${userId}`);
    
    // Resolve fallback user if userId is not explicitly supplied (e.g. legacy webhooks)
    if (!userId) {
      const firstUser = await User.findOne();
      userId = firstUser ? firstUser._id : null;
    }

    const peerId = channel === 'whatsapp' ? phone : telegramId;
    let contact = await ContactRepository.findByChannelId(channel, peerId, userId);
    
    if (!contact) {
      console.log(`[ContactService] Contact not found, creating new contact`);
      contact = await ContactRepository.create({
        userId,
        name: name || (channel === 'whatsapp' ? `WhatsApp User (${peerId})` : `Telegram User (${peerId})`),
        phone: channel === 'whatsapp' ? phone : undefined,
        telegramId: channel === 'telegram' ? telegramId : undefined,
        channel,
        profilePhoto: profilePhoto || ''
      });
    } else if (name && contact.name !== name) {
      contact.name = name;
      await contact.save();
    }
    
    return contact;
  }
  
  async getContacts() {
    return ContactRepository.findAll();
  }
}

export default new ContactService();
