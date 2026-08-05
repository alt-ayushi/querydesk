/**
 * aiService.js
 *
 * Official Mistral completions handler.
 * Config comes from environment variables in backend/.env.
 */

function getConfig() {
  const mistralApiKey = process.env.MISTRAL_API_KEY;
  const mistralModel = process.env.MISTRAL_MODEL || 'mistral-large-latest';
  const mistralBaseUrl = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';

  return {
    mistralApiKey,
    mistralModel,
    mistralBaseUrl
  };
}

/**
 * Custom fetch wrapper that implements exponential backoff retry logic for Mistral API.
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`[Mistral] Request attempt ${attempt}/${maxRetries + 1}`);
      console.log('[Flow] Waiting for Mistral Response');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        const status = response.status;

        if (status === 401) {
          throw new Error(`Unauthorized (401): Invalid Mistral API Key. ${errText}`);
        } else if (status === 403) {
          throw new Error(`Forbidden (403): Access denied. ${errText}`);
        } else if (status === 429) {
          console.warn(`[Mistral] Rate limit hit (429).`);
        } else if (status >= 500) {
          console.warn(`[Mistral] Internal server error (${status}).`);
        }

        const error = new Error(`HTTP Error ${status}: ${errText}`);
        error.status = status;
        throw error;
      }

      return response;

    } catch (error) {
      console.error(`[Mistral] Attempt ${attempt} failed: ${error.message}`);

      if (attempt <= maxRetries) {
        console.log(`[Mistral] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = delay * 2 + Math.floor(Math.random() * 200); // exponential backoff with jitter
      } else {
        throw error;
      }
    }
  }
}

/**
 * Generates a single AI response (non-streaming) using the official Mistral API.
 * @param {Array}  history  - Array of { role: 'user'|'assistant', text: string }
 * @param {String} sessionKey - Session key (kept for interface compatibility)
 * @returns {Promise<string>} assistant reply
 */
export async function generateAIResponse(history, sessionKey = 'agent:maya:default') {
  const config = getConfig();

  if (!config.mistralApiKey || config.mistralApiKey.startsWith('your_') || config.mistralApiKey.trim().length === 0) {
    throw new Error('Mistral API key is not configured or is a placeholder.');
  }

  const systemPrompt = {
    role: 'system',
    content: 'You are Maya, an intelligent AI assistant. Always respond dynamically and contextually to the user\'s message without repeating generic canned greetings.'
  };

  const messages = [
    systemPrompt,
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: h.text || h.message || ''
    }))
  ];

  const targetUrl = `${config.mistralBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.mistralApiKey}`
  };
  const bodyPayload = {
    model: config.mistralModel,
    messages
  };

  console.log(`[LLM]\nProvider: Mistral\nSending completions to Mistral (${config.mistralModel})`);

  try {
    const response = await fetchWithRetry(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    }, 3);

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      const err = new Error('Mistral returned an empty response');
      err.status = 500;
      throw err;
    }

    console.log(`[LLM]\nProvider: Mistral\nStatus: Success`);
    return reply.trim();
  } catch (error) {
    console.warn(`[LLM]\nProvider: Mistral\nStatus: Failed\nReason: ${error.message}`);
    throw error;
  }
}

/**
 * Generates a streaming AI response using the official Mistral API, calling onChunk for each token.
 * Used by the web chat endpoint (SSE).
 * @param {Array}    history    - Array of { role, text|message }
 * @param {String}    sessionKey - Session key (kept for interface compatibility)
 * @param {Function} onChunk    - Called with each text chunk
 */
export async function generateAIResponseStream(history, sessionKey = 'agent:maya:default', onChunk) {
  if (typeof sessionKey === 'function') {
    onChunk = sessionKey;
    sessionKey = 'agent:maya:default';
  }

  const config = getConfig();

  if (!config.mistralApiKey || config.mistralApiKey.startsWith('your_') || config.mistralApiKey.trim().length === 0) {
    throw new Error('Mistral API key is not configured or is a placeholder.');
  }

  const messages = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'assistant',
    content: h.text || h.message || ''
  }));

  const targetUrl = `${config.mistralBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.mistralApiKey}`
  };
  const bodyPayload = {
    model: config.mistralModel,
    messages,
    stream: true
  };

  console.log(`[LLM]\nProvider: Mistral\nStreaming completions from Mistral (${config.mistralModel})`);

  try {
    const response = await fetchWithRetry(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    }, 3);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) onChunk(chunk);
        } catch {
          // ignore partial JSON
        }
      }
    }

    console.log(`[LLM]\nProvider: Mistral\nStatus: Success`);
  } catch (error) {
    console.warn(`[LLM]\nProvider: Mistral\nStatus: Failed\nReason: ${error.message}`);
    throw error;
  }
}

/**
 * Channel-agnostic AI response generator for a conversation.
 * Loads history from MongoDB Message model, formats messages, and executes Mistral completion.
 * Returns the assistant reply string (without performing messaging transport delivery).
 *
 * @param {Object} param0
 * @param {string} param0.conversationId - Conversation Mongoose ID
 * @param {string} param0.userId - Authenticated User ID
 * @param {number} [param0.limit=15] - Number of history messages to load
 * @returns {Promise<string>} Assistant reply text
 */
export async function generateAIResponseForConversation({ conversationId, userId, limit = 15 }) {
  const Message = (await import('../models/Message.js')).default;
  const historyLogs = (await Message.find({ conversationId, userId })
    .sort({ timestamp: -1 })
    .limit(limit)).reverse();

  const history = historyLogs.map(h => ({
    role: h.role,
    text: h.text || h.message || ''
  }));

  return await generateAIResponse(history);
}

/**
 * Generates an AI response for an image message using Mistral Vision API.
 * @param {Array} history - History array of { role, text }
 * @param {String} imageBase64 - Image base64 string or data URL
 * @param {String} prompt - User text prompt / caption
 * @returns {Promise<string>} Assistant reply text
 */
export async function validateVisionStartup() {
  console.log('\nStartup Checks');
  const apiKey = process.env.MISTRAL_API_KEY;
  const textModel = process.env.MISTRAL_MODEL || 'mistral-large-latest';
  const visionModel = process.env.MISTRAL_VISION_MODEL || 'pixtral-12b-2409';

  console.log(`✓ MISTRAL_API_KEY ${apiKey ? 'found' : 'missing'}`);
  console.log(`✓ MISTRAL_MODEL found: ${textModel}`);
  console.log(`✓ MISTRAL_VISION_MODEL found: ${visionModel}`);
  console.log(`Vision Model:\n${visionModel}`);

  if (!apiKey) {
    console.warn('⚠️ MISTRAL_API_KEY is not configured.');
    return;
  }

  try {
    const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const baseUrl = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'ping' },
              { type: 'image_url', image_url: { url: dummyBase64 } }
            ]
          }
        ]
      })
    });

    if (res.ok) {
      console.log('✓ Vision endpoint reachable\n');
    } else {
      const errText = await res.text();
      console.warn(`⚠️ Vision endpoint check returned status ${res.status}: ${errText.slice(0, 150)}\n`);
    }
  } catch (err) {
    console.warn(`⚠️ Vision endpoint reachability check failed: ${err.message}\n`);
  }
}

/**
 * Generates an AI response for an image message using Mistral Vision API.
 * @param {Array} history - History array of { role, text }
 * @param {String} imageBase64 - Image base64 string or data URL
 * @param {String} prompt - User text prompt / caption
 * @returns {Promise<string>} Assistant reply text
 */
export async function generateVisionAIResponse(history = [], imageBase64, prompt = 'Describe this image.') {
  const startTime = Date.now();
  console.log('\n[IMAGE 1/8]\nImage received');

  const sizeBytes = imageBase64 ? Buffer.byteLength(imageBase64, 'utf8') : 0;
  const imageType = imageBase64 ? (imageBase64.match(/^data:(image\/[a-zA-Z0-9+]+);base64,/) || [])[1] || 'image/jpeg' : 'unknown';
  console.log(`Image size: ${sizeBytes} bytes (${(sizeBytes / 1024).toFixed(2)} KB)`);
  console.log(`Image type: ${imageType}`);
  console.log(`Buffer length: ${sizeBytes}`);

  console.log('\n[IMAGE 2/8]\nValidated');
  const config = getConfig();
  const visionModel = process.env.MISTRAL_VISION_MODEL || 'pixtral-12b-2409';
  console.log(`Model: ${visionModel}`);

  if (!config.mistralApiKey || config.mistralApiKey.startsWith('your_') || config.mistralApiKey.trim().length === 0) {
    console.error('[IMAGE Error] Mistral API key is not configured or is a placeholder.');
    throw new Error('Mistral API key is not configured or is a placeholder.');
  }

  console.log('\n[IMAGE 3/8]\nEncoded');
  let imageUrl = imageBase64 || '';
  if (imageUrl && !imageUrl.startsWith('data:') && !imageUrl.startsWith('http')) {
    imageUrl = `data:image/jpeg;base64,${imageUrl}`;
  }

  const systemPrompt = {
    role: 'system',
    content: 'You are Maya, an intelligent AI assistant capable of analyzing images. Provide clear, helpful, accurate, and detailed descriptions or answers based on the image provided.'
  };

  const formattedHistory = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'assistant',
    content: h.text || h.message || ''
  }));

  const userVisionTurn = {
    role: 'user',
    content: [
      { type: 'text', text: prompt || 'Describe this image.' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  };

  const messages = [
    systemPrompt,
    ...formattedHistory,
    userVisionTurn
  ];

  console.log('\n[IMAGE 4/8]\nVision request created');
  const targetUrl = `${config.mistralBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.mistralApiKey}`
  };
  const bodyPayload = {
    model: visionModel,
    messages
  };

  try {
    const response = await fetchWithRetry(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload)
    }, 3);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n[IMAGE 5/8]\nVision API completed\nTime: ${elapsedSec}s`);

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('Mistral returned empty vision response');
    }

    return reply.trim();
  } catch (error) {
    console.error('[IMAGE Error] Vision API request failed:');
    console.error(error.stack || error);
    throw error;
  }
}

/**
 * Channel-agnostic Vision AI response generator for a conversation.
 * Loads history from MongoDB Message model, formats messages, and executes Mistral Vision completion.
 */
export async function generateVisionAIResponseForConversation({ conversationId, userId, imageBase64, prompt, limit = 10 }) {
  const Message = (await import('../models/Message.js')).default;
  const historyLogs = (await Message.find({ conversationId, userId })
    .sort({ timestamp: -1 })
    .limit(limit)).reverse();

  const history = historyLogs.map(h => ({
    role: h.role,
    text: h.text || h.message || ''
  }));

  return await generateVisionAIResponse(history, imageBase64, prompt);
}


