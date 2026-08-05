import mongoose from 'mongoose';

const channelSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'telegram'],
    required: true
  },
  connected: {
    type: Boolean,
    default: false
  },
  qrCode: {
    type: String,
    default: null
  },
  phoneNumber: {
    type: String,
    default: null
  },
  botUsername: {
    type: String,
    default: null
  },
  botToken: {
    type: String,
    default: null
  },
  lastError: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

channelSessionSchema.index({ userId: 1, channel: 1 }, { unique: true });

const ChannelSession = mongoose.model('ChannelSession', channelSessionSchema);
export default ChannelSession;
