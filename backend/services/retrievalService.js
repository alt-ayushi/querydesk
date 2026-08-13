/**
 * retrievalService.js
 *
 * Multimodal RAG Retrieval Layer.
 * Combines Text Retriever and Visual Retriever with Cross-Modal Search,
 * Result Fusion, and automatic text-only RAG fallback.
 */

import TextChunk from '../models/TextChunk.js';
import VisualChunk from '../models/VisualChunk.js';
import Document from '../models/Document.js';
import { generateEmbedding, cosineSimilarity } from './embeddingService.js';
import { isVisionEnabled } from './visionService.js';

/**
 * Retrieves relevant text chunks from text_chunks vector collection.
 *
 * @param {string} query 
 * @param {string} userId 
 * @param {number} topK 
 * @returns {Promise<Array<Object>>} Ranked text results
 */
export async function textRetrieve(query, userId, topK = 5) {
  try {
    const queryVector = await generateEmbedding(query);
    const textChunks = await TextChunk.find({ userId }).populate('documentId', 'title originalName');

    const scored = textChunks.map(chunk => {
      const simScore = cosineSimilarity(queryVector, chunk.embedding || []);
      return {
        type: 'text',
        chunkId: chunk._id,
        documentId: chunk.documentId?._id || chunk.documentId,
        documentTitle: chunk.documentId?.title || chunk.documentId?.originalName || 'Document',
        pageNumber: chunk.pageNumber || 1,
        content: chunk.text,
        score: simScore
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    const results = scored.filter(item => item.score > 0.1).slice(0, topK);
    console.log(`[MultimodalRAG] Text results: ${results.length}`);
    return results;

  } catch (err) {
    console.error(`[MultimodalRAG] Text retrieval error: ${err.message}`);
    return [];
  }
}

/**
 * Retrieves relevant visual elements from visual_chunks vector collection.
 * Supports Cross-Modal Retrieval (Text -> Image, Text -> Chart, Text -> Description).
 *
 * @param {string} query 
 * @param {string} userId 
 * @param {number} topK 
 * @returns {Promise<Array<Object>>} Ranked visual results
 */
export async function visualRetrieve(query, userId, topK = 3) {
  if (!isVisionEnabled()) {
    console.log('[MultimodalRAG] Visual retrieval skipped (VISION_ENABLED=false)');
    return [];
  }

  try {
    const queryVector = await generateEmbedding(query);
    const visualChunks = await VisualChunk.find({ userId }).populate('documentId', 'title originalName');

    const isVisualQuery = /diagram|chart|graph|figure|architecture|image|table|screenshot|workflow/i.test(query);

    const scored = visualChunks.map(chunk => {
      let simScore = cosineSimilarity(queryVector, chunk.embedding || []);
      
      // Boost visual score if query explicitly requests visual assets
      if (isVisualQuery) {
        simScore = Math.min(1.0, simScore * 1.3);
      }

      return {
        type: 'image',
        visualId: chunk._id,
        imageId: chunk.imageId,
        imageType: chunk.imageType || 'image',
        imageUrl: chunk.imageUrl,
        documentId: chunk.documentId?._id || chunk.documentId,
        documentTitle: chunk.documentId?.title || chunk.documentId?.originalName || 'Document',
        pageNumber: chunk.pageNumber || 1,
        description: chunk.description,
        score: simScore
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.filter(item => item.score > 0.15).slice(0, topK);
    console.log(`[MultimodalRAG] Visual results: ${results.length}`);
    return results;

  } catch (err) {
    console.error(`[MultimodalRAG] Visual retrieval error (falling back): ${err.message}`);
    return [];
  }
}

/**
 * Result Fusion: Interleaves and ranks combined text and visual results.
 *
 * @param {Array} textResults 
 * @param {Array} visualResults 
 * @param {number} topK 
 * @returns {Array} Combined, deduplicated, and ranked results
 */
export function fuseResults(textResults = [], visualResults = [], topK = 8) {
  const combined = [...textResults, ...visualResults];

  // Rank by similarity score
  combined.sort((a, b) => b.score - a.score);

  console.log(`[MultimodalRAG] Combined results: ${combined.length}`);
  return combined.slice(0, topK);
}

/**
 * Executes full Multimodal Retrieval pipeline with automatic text RAG fallback.
 *
 * @param {string} query 
 * @param {string} userId 
 * @returns {Promise<Object>} { fusedResults, textCount, visualCount, formattedContext }
 */
export async function retrieveMultimodalContext(query, userId) {
  let textResults = [];
  let visualResults = [];

  try {
    textResults = await textRetrieve(query, userId, 5);
  } catch (tErr) {
    console.warn(`[MultimodalRAG] Text retriever failed: ${tErr.message}`);
  }

  try {
    visualResults = await visualRetrieve(query, userId, 3);
  } catch (vErr) {
    console.warn(`[MultimodalRAG] Visual retriever failed (falling back to text): ${vErr.message}`);
    visualResults = [];
  }

  const fusedResults = fuseResults(textResults, visualResults, 8);

  // Format context for LLM consumption
  let textContextStr = '';
  let visualContextStr = '';
  const visualSources = [];

  fusedResults.forEach(item => {
    if (item.type === 'text') {
      textContextStr += `\n--- [Text Source: ${item.documentTitle}, Page ${item.pageNumber}] ---\n${item.content}\n`;
    } else if (item.type === 'image') {
      visualContextStr += `\n--- [Visual Source: ${item.documentTitle}, Page ${item.pageNumber} (${item.imageType})] ---\nImage Description:\n${item.description}\n`;
      visualSources.push({
        imageId: item.imageId,
        documentTitle: item.documentTitle,
        pageNumber: item.pageNumber,
        imageType: item.imageType,
        imageUrl: item.imageUrl,
        description: item.description
      });
    }
  });

  let fullPromptContext = '';
  if (textContextStr.trim()) {
    fullPromptContext += `\nTEXT CONTEXT:\n${textContextStr}\n`;
  }
  if (visualContextStr.trim()) {
    fullPromptContext += `\nVISUAL CONTEXT:\n${visualContextStr}\n`;
  }

  return {
    fusedResults,
    textCount: textResults.length,
    visualCount: visualResults.length,
    fullPromptContext,
    visualSources
  };
}
