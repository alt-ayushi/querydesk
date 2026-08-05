import mongoose from 'mongoose';
import User from './models/User.js';
import ChannelSession from './models/ChannelSession.js';
import Conversation from './models/Conversation.js';
import Message from './models/Message.js';
import Contact from './models/Contact.js';

export async function runMigration() {
  console.log('[Migration] Checking database for schema updates...');
  try {
    // Drop old unique indexes that conflict with new multi-user constraints
    try {
      const channelSessionsCollection = mongoose.connection.collection('channelsessions');
      await channelSessionsCollection.dropIndex('channel_1');
      console.log('[Migration] Dropped old unique index: channelsessions.channel_1');
    } catch (e) {
      // Index might not exist, ignore
    }

    try {
      const conversationsCollection = mongoose.connection.collection('conversations');
      await conversationsCollection.dropIndex('channel_1_peerId_1');
      console.log('[Migration] Dropped old unique index: conversations.channel_1_peerId_1');
    } catch (e) {
      // Index might not exist, ignore
    }

    const firstUser = await User.findOne();
    if (!firstUser) {
      console.log('[Migration] No users found in database. Migration skipped until a user registers.');
      return;
    }

    const userId = firstUser._id;
    console.log(`[Migration] Migrating existing database records to first user: ${firstUser.email} (${userId})`);

    // Migrate ChannelSession
    const csResult = await ChannelSession.updateMany(
      { userId: { $exists: false } },
      { $set: { userId } }
    );
    if (csResult.modifiedCount > 0) {
      console.log(`[Migration] Updated ${csResult.modifiedCount} ChannelSession records.`);
    }

    // Migrate Conversation
    const convResult = await Conversation.updateMany(
      { userId: { $exists: false } },
      { $set: { userId } }
    );
    if (convResult.modifiedCount > 0) {
      console.log(`[Migration] Updated ${convResult.modifiedCount} Conversation records.`);
    }

    // Migrate Message
    const msgResult = await Message.updateMany(
      { userId: { $exists: false } },
      { $set: { userId } }
    );
    if (msgResult.modifiedCount > 0) {
      console.log(`[Migration] Updated ${msgResult.modifiedCount} Message records.`);
    }

    // Migrate Contact
    const contactResult = await Contact.updateMany(
      { userId: { $exists: false } },
      { $set: { userId } }
    );
    if (contactResult.modifiedCount > 0) {
      console.log(`[Migration] Updated ${contactResult.modifiedCount} Contact records.`);
    }

    console.log('[Migration] Database migration completed successfully.');
  } catch (error) {
    console.error('[Migration] Error during migration:', error.message);
  }
}
