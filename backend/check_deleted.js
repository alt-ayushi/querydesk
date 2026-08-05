import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ayushipancholi07_db_user:vaZ778bli7E8z69V@cluster0.skbtafo.mongodb.net/?appName=Cluster0';

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  const Contact = mongoose.model('Contact', new mongoose.Schema({}, { strict: false }));
  const Conversation = mongoose.model('Conversation', new mongoose.Schema({}, { strict: false }));

  console.log('\n--- Contacts currently in MongoDB ---');
  const contacts = await Contact.find({});
  for (const c of contacts) {
    console.log(`- Contact ID: ${c._id}, Name: "${c.name}", Telegram ID: "${c.telegramId || ''}", Channel: "${c.channel}"`);
  }

  console.log('\n--- Conversations currently in MongoDB ---');
  const conversations = await Conversation.find({});
  for (const c of conversations) {
    console.log(`- Conv ID: ${c._id}, Title: "${c.title}", Peer ID: "${c.peerId}", Channel: "${c.channel}"`);
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(err => console.error(err));
