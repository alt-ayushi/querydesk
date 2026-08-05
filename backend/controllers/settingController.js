/**
 * settingController.js
 *
 * Read-only status endpoint.
 * All configuration (API keys, model, URLs) lives in backend/.env.
 * No forms. No credential storage. No provider selection.
 */
import ChannelSession from '../models/ChannelSession.js';

/**
 * GET /api/status
 * Returns channel connection status and which LLM model is configured.
 * Never returns API keys.
 */
export const getStatus = async (req, res) => {
  try {
    const sessions = await ChannelSession.find();

    const status = {
      model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
      openRouterConfigured: !!(process.env.MISTRAL_API_KEY && !process.env.MISTRAL_API_KEY.includes('your_')),
      channels: sessions.map(s => ({
        channel: s.channel,
        connected: s.connected,
        phoneNumber: s.phoneNumber,
        botUsername: s.botUsername
      }))
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
