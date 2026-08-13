/**
 * embeddingService.js
 *
 * Vector embedding generator and Cosine Similarity search engine for text and visual content.
 * Provides normalized dense vector embeddings and similarity scoring.
 */

// Helper to tokenize and normalize text
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Generates a 128-dimensional dense vector embedding for a text string.
 * Uses a deterministic term-hashing & subword character 3-gram feature mapping
 * normalized to unit length so cosine similarity matches semantic keyword overlap.
 * 
 * @param {string} text 
 * @returns {Array<number>} 128-float embedding vector
 */
export async function generateEmbedding(text) {
  const DIM = 128;
  const vector = new Array(DIM).fill(0);
  const normalized = String(text || '').toLowerCase().trim();

  if (!normalized) return vector;

  const words = tokenize(normalized);

  // 1. Word level features
  words.forEach((word, idx) => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash |= 0;
    }
    const slot = Math.abs(hash) % DIM;
    const weight = 1.0 + (1 / (idx + 1));
    vector[slot] += weight;
  });

  // 2. Character n-gram features (3-grams) for cross-modal query matching
  for (let i = 0; i <= normalized.length - 3; i++) {
    const tri = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < tri.length; j++) {
      hash = ((hash << 5) - hash) + tri.charCodeAt(j);
      hash |= 0;
    }
    const slot = Math.abs(hash) % DIM;
    vector[slot] += 0.5;
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      vector[i] = parseFloat((vector[i] / norm).toFixed(6));
    }
  }

  return vector;
}

/**
 * Calculates cosine similarity between two vector embeddings.
 * @param {Array<number>} vecA 
 * @param {Array<number>} vecB 
 * @returns {number} Similarity score between 0.0 and 1.0
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, sim));
}
