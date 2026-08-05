import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  activeProvider: {
    type: String,
    enum: ['gemini', 'openrouter', 'openai'],
    default: 'openrouter'
  },
  geminiApiKey: {
    type: String,
    default: ''
  },
  geminiModel: {
    type: String,
    default: 'gemini-1.5-pro'
  },
  openrouterApiKey: {
    type: String,
    default: ''
  },
  openrouterModel: {
    type: String,
    default: 'meta-llama/llama-3.1-70b-instruct'
  },
  openaiApiKey: {
    type: String,
    default: ''
  },
  openaiModel: {
    type: String,
    default: 'gpt-4o'
  },
  telegramBotToken: {
    type: String,
    default: ''
  },
  telegramBotUsername: {
    type: String,
    default: ''
  },
  telegramBotName: {
    type: String,
    default: ''
  },
  temperature: {
    type: Number,
    default: 0.7
  },
  maxTokens: {
    type: Number,
    default: 2048
  },
  systemPrompt: {
    type: String,
    default: 'You are QueryDesk, a helpful multi-channel AI assistant.'
  }
}, {
  timestamps: true
});

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
