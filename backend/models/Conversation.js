import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    index: true
  },
  channel: {
    type: String,
    enum: ['web', 'whatsapp', 'telegram'],
    required: true
  },
  peerId: {
    type: String,
    required: true,
    index: true
  },
  sessionId: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  },
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  unreadCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Ensure compound index for userId + channel + peerId is unique
conversationSchema.index({ userId: 1, channel: 1, peerId: 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;
