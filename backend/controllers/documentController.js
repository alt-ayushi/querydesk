/**
 * documentController.js
 *
 * Express Controller for Document Management and Multimodal RAG Retrieval.
 */

import multer from 'multer';
import Document from '../models/Document.js';
import TextChunk from '../models/TextChunk.js';
import VisualChunk from '../models/VisualChunk.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { ingestDocument, runVisionPipelineAsync } from '../services/documentService.js';
import { retrieveMultimodalContext } from '../services/retrievalService.js';
import { generateAIResponseStream } from '../services/aiService.js';
import { getSocketIO } from '../socket/index.js';

// Multer memory storage configuration for file uploads
const storage = multer.memoryStorage();
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB limit
}).single('file');

export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { title } = req.body;
    const fileBuffer = req.file.buffer;
    const originalName = req.file.originalname;
    const mimeType = req.file.mimetype;

    let fileType = 'pdf';
    if (mimeType.includes('image') || /\.(png|jpg|jpeg|webp)$/i.test(originalName)) {
      fileType = 'image';
    } else if (mimeType.includes('pdf') || /\.pdf$/i.test(originalName)) {
      fileType = 'pdf';
    } else {
      fileType = 'text';
    }

    const document = await ingestDocument({
      userId: req.user._id,
      title: title || originalName,
      originalName,
      fileType,
      fileBuffer
    });

    res.status(201).json({
      message: 'Document uploaded and processing initiated successfully',
      document
    });

  } catch (error) {
    console.error('[DocumentController] Upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload document' });
  }
};

export const getDocuments = async (req, res) => {
  try {
    const documents = await Document.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getDocumentById = async (req, res) => {
  try {
    const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!document) return res.status(404).json({ error: 'Document not found' });

    await Document.findByIdAndDelete(req.params.id);
    await TextChunk.deleteMany({ documentId: req.params.id, userId: req.user._id });
    await VisualChunk.deleteMany({ documentId: req.params.id, userId: req.user._id });

    res.json({ message: 'Document and all vector chunks deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const triggerVisualProcess = async (req, res) => {
  try {
    const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!document) return res.status(404).json({ error: 'Document not found' });

    document.visionProcessingStatus = 'processing';
    await document.save();

    // Trigger async processing
    runVisionPipelineAsync(document, null, document.fileType, req.user._id).catch(err => {
      console.warn('[DocumentController] Visual re-process error handled:', err.message);
    });

    res.json({ message: 'Visual processing triggered successfully', document });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getDocumentVisuals = async (req, res) => {
  try {
    const visuals = await VisualChunk.find({ documentId: req.params.id, userId: req.user._id });
    res.json(visuals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const handleMultimodalRetrieval = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const retrievalResult = await retrieveMultimodalContext(query, req.user._id);
    res.json(retrievalResult);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const handleMultimodalChat = async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message query is required' });

    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
    }

    const io = getSocketIO();

    if (!conversation) {
      conversation = await Conversation.create({
        userId: req.user._id,
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        channel: 'web',
        peerId: 'web-' + Math.random().toString(36).substr(2, 9),
        status: 'active'
      });
      if (io) io.to(`user_${req.user._id}`).emit('conversation:new', conversation);
    }

    // Save user message
    const userMsg = await Message.create({
      userId: req.user._id,
      conversationId: conversation._id,
      text: message,
      role: 'user',
      direction: 'inbound',
      channel: 'web',
      timestamp: new Date(),
      status: 'read'
    });

    conversation.lastMessage = message;
    conversation.lastMessageAt = userMsg.timestamp;
    await conversation.save();

    if (io) {
      io.to(`user_${req.user._id}`).emit('message:new', userMsg);
      io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
      io.to(`user_${req.user._id}`).emit('typing:start', { conversationId: conversation._id });
    }

    // 1. Perform Multimodal Retrieval (Text + Visuals)
    const ragContext = await retrieveMultimodalContext(message, req.user._id);

    // 2. Load past conversation history
    const historyLogs = await Message.find({ conversationId: conversation._id, userId: req.user._id })
      .sort({ timestamp: 1 })
      .limit(10);

    const history = historyLogs.map(h => ({
      role: h.role,
      text: h.text || h.message || ''
    }));

    // Inject RAG Context into user prompt turn
    const augmentedUserTurn = `${message}\n\n[RETRIEVED MULTIMODAL KNOWLEDGE CONTEXT]:${ragContext.fullPromptContext || '\n(No relevant documents found)\n'}\nInstructions: Use the above retrieved text context and visual context (descriptions of diagrams, charts, tables) to answer the query accurately. Mention the source document name and page number when citing visual evidence.`;

    const lastTurnIdx = history.findLastIndex(h => h.role === 'user');
    if (lastTurnIdx !== -1) {
      history[lastTurnIdx].text = augmentedUserTurn;
    } else {
      history.push({ role: 'user', text: augmentedUserTurn });
    }

    // SSE Stream response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send metadata header with visual sources
    res.write(`data: ${JSON.stringify({
      conversationId: conversation._id,
      userMessage: userMsg,
      visualSources: ragContext.visualSources
    })}\n\n`);

    let fullReply = '';

    try {
      await generateAIResponseStream(history, (chunk) => {
        fullReply += chunk;
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      });

      const assistantMsg = await Message.create({
        userId: req.user._id,
        conversationId: conversation._id,
        text: fullReply,
        role: 'assistant',
        direction: 'outbound',
        channel: 'web',
        timestamp: new Date(),
        status: 'read'
      });

      conversation.lastMessage = fullReply;
      conversation.lastMessageAt = assistantMsg.timestamp;
      await conversation.save();

      if (io) {
        io.to(`user_${req.user._id}`).emit('typing:stop', { conversationId: conversation._id });
        io.to(`user_${req.user._id}`).emit('message:new', assistantMsg);
        io.to(`user_${req.user._id}`).emit('conversation:update', conversation);
      }

      res.write('data: [DONE]\n\n');
      res.end();

    } catch (aiErr) {
      console.error('[MultimodalChat] Stream error:', aiErr);
      res.write(`data: ${JSON.stringify({ error: aiErr.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
