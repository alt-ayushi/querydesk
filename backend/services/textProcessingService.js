/**
 * textProcessingService.js
 *
 * Traditional text extraction, chunking, embedding, and storage service for QueryDesk RAG.
 */

import { createRequire } from 'module';
import TextChunk from '../models/TextChunk.js';
import { generateEmbedding } from './embeddingService.js';

const require = createRequire(import.meta.url);
const pdfModule = require('pdf-parse');

/**
 * Universal PDF parser helper supporting pdf-parse module variations.
 * @param {Buffer} fileBuffer 
 * @returns {Promise<Object>} { text, numpages, pages }
 */
async function parsePdfBuffer(fileBuffer) {
  if (typeof pdfModule === 'function') {
    const data = await pdfModule(fileBuffer);
    return {
      text: data.text || '',
      numpages: data.numpages || 1,
      pages: (data.text || '').split(/\f|\n{3,}/).map((t, i) => ({ pageNumber: i + 1, text: t }))
    };
  }

  if (pdfModule.PDFParse) {
    const parser = new pdfModule.PDFParse({ data: fileBuffer });
    const res = await parser.getText();
    const pages = (res.pages || []).map(p => ({ pageNumber: p.num || 1, text: p.text || '' }));
    return {
      text: res.text || '',
      numpages: res.total || pages.length || 1,
      pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: res.text || '' }]
    };
  }

  // Fallback: search for printable text strings in buffer
  const rawStr = fileBuffer.toString('latin1').replace(/[^\x20-\x7E\n\r]/g, ' ');
  return {
    text: rawStr,
    numpages: 1,
    pages: [{ pageNumber: 1, text: rawStr }]
  };
}

/**
 * Splits text content into overlapping text chunks.
 *
 * @param {string} text 
 * @param {number} chunkSize 
 * @param {number} chunkOverlap 
 * @returns {Array<string>} Array of text chunk strings
 */
export function chunkText(text, chunkSize = 500, chunkOverlap = 50) {
  if (!text || typeof text !== 'string') return [];

  const cleanText = text.replace(/\r\n/g, '\n').trim();
  if (cleanText.length <= chunkSize) return [cleanText];

  const chunks = [];
  let start = 0;

  while (start < cleanText.length) {
    let end = start + chunkSize;
    
    // Try to break at newline or space to preserve sentence/paragraph boundaries
    if (end < cleanText.length) {
      const lastNewline = cleanText.lastIndexOf('\n', end);
      if (lastNewline > start + Math.floor(chunkSize / 2)) {
        end = lastNewline + 1;
      } else {
        const lastSpace = cleanText.lastIndexOf(' ', end);
        if (lastSpace > start + Math.floor(chunkSize / 2)) {
          end = lastSpace + 1;
        }
      }
    }

    const chunkStr = cleanText.slice(start, end).trim();
    if (chunkStr.length > 0) {
      chunks.push(chunkStr);
    }

    start = end - chunkOverlap;
    if (start >= cleanText.length || end >= cleanText.length) break;
  }

  return chunks;
}

/**
 * Processes text document buffer: extracts raw text, generates chunks & embeddings,
 * and saves into TextChunk (text_chunks collection).
 *
 * @param {string} documentId 
 * @param {string} userId 
 * @param {Buffer} fileBuffer 
 * @param {string} fileType ('pdf' | 'text' | 'image')
 * @returns {Promise<Object>} Ingestion stats { textChunkCount, pageCount }
 */
export async function processTextDocument(documentId, userId, fileBuffer, fileType = 'pdf') {
  console.log(`[TextPipeline] Processing document ${documentId} (Type: ${fileType})`);
  let extractedPages = [];
  let pageCount = 1;

  try {
    if (fileType.includes('pdf') && fileBuffer) {
      const pdfData = await parsePdfBuffer(fileBuffer);
      pageCount = pdfData.numpages || 1;
      
      if (pdfData.pages && pdfData.pages.length > 0) {
        pdfData.pages.forEach(p => {
          if (p.text && p.text.trim()) {
            extractedPages.push({ pageNumber: p.pageNumber || 1, text: p.text.trim() });
          }
        });
      }
      if (extractedPages.length === 0) {
        extractedPages.push({ pageNumber: 1, text: (pdfData.text || '').trim() });
      }
    } else {
      // Plain text or fallback
      const textContent = fileBuffer ? fileBuffer.toString('utf8') : '';
      extractedPages.push({ pageNumber: 1, text: textContent.trim() });
    }

    let totalChunksCount = 0;

    for (const pageObj of extractedPages) {
      const textChunks = chunkText(pageObj.text, 500, 50);

      for (let idx = 0; idx < textChunks.length; idx++) {
        const chunkTextStr = textChunks[idx];
        const embedding = await generateEmbedding(chunkTextStr);

        await TextChunk.create({
          userId,
          documentId,
          pageNumber: pageObj.pageNumber,
          chunkIndex: idx,
          text: chunkTextStr,
          embedding,
          metadata: {
            source: 'text_pipeline',
            pageNumber: pageObj.pageNumber,
            length: chunkTextStr.length
          }
        });

        totalChunksCount++;
      }
    }

    console.log(`[TextPipeline] Successfully stored ${totalChunksCount} text chunks across ${pageCount} pages`);
    return { textChunkCount: totalChunksCount, pageCount };

  } catch (err) {
    console.error(`[TextPipeline] Text processing error: ${err.message}`);
    throw err;
  }
}
