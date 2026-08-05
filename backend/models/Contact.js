import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    index: true
  },
  telegramId: {
    type: String,
    trim: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'telegram', 'web'],
    required: true
  },
  profilePhoto: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

const Contact = mongoose.model('Contact', contactSchema);
export default Contact;
