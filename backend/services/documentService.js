/**
 * documentService.js
 *
 * Dual-Pipeline Document Ingestion Coordinator.
 * Manages parallel independent Text and Vision processing pipelines with fault-tolerant error handling.
 */

import Document from '../models/Document.js';
import TextChunk from '../models/TextChunk.js';
import VisualChunk from '../models/VisualChunk.js';
import { processTextDocument } from './textProcessingService.js';
import {
  extractVisualContent,
  describeVisualContent,
  generateVisualEmbedding,
  isVisionEnabled
} from './visionService.js';

/**
 * Ingests a new document by executing Dual Independent Ingestion Pipelines:
 * Pipeline 1: Text Extraction, Chunking, Text Vector Storage
 * Pipeline 2: Vision Extraction, Visual Description, Vision Vector Storage (Async/Fault-tolerant)
 *
 * @param {Object} param0 
 * @param {string} param0.userId 
 * @param {string} param0.title 
 * @param {string} param0.originalName 
 * @param {string} param0.fileType 
 * @param {Buffer} param0.fileBuffer 
 * @param {string} [param0.fileUrl] 
 * @returns {Promise<Object>} Created document record
 */
export async function ingestDocument({ userId, title, originalName, fileType, fileBuffer, fileUrl }) {
  console.log(`[Ingestion] Starting dual pipeline ingestion for "${title}" (${fileType})`);

  // Create initial Document record in DB
  const doc = await Document.create({
    userId,
    title: title || originalName || 'Untitled Document',
    originalName: originalName || title,
    fileType: fileType || 'pdf',
    fileUrl: fileUrl || '',
    size: fileBuffer ? fileBuffer.length : 0,
    status: 'processing',
    visionProcessingStatus: 'pending'
  });

  // ── PIPELINE 1: Text Pipeline (Synchronous core RAG) ──
  let textStats = { textChunkCount: 0, pageCount: 1 };
  try {
    textStats = await processTextDocument(doc._id, userId, fileBuffer, fileType);
    doc.textChunkCount = textStats.textChunkCount;
    doc.pageCount = textStats.pageCount;
    doc.status = 'completed';
    await doc.save();
    console.log(`[TextPipeline] Document ${doc._id} text ingestion completed: SUCCESS`);
  } catch (textErr) {
    console.error(`[TextPipeline] Document ${doc._id} text ingestion failed: ${textErr.message}`);
    doc.status = 'failed';
    await doc.save();
    throw textErr;
  }

  // ── PIPELINE 2: Vision Pipeline (Async & Fault-tolerant) ──
  // Launch asynchronously in background so response returns quickly
  runVisionPipelineAsync(doc, fileBuffer, fileType, userId).catch(vErr => {
    console.warn(`[Vision] Background vision processing exception handled: ${vErr.message}`);
  });

  return doc;
}

/**
 * Executes the Vision Pipeline asynchronously for a document.
 * Fault-tolerant: Failures in vision processing will NEVER corrupt or break the document status.
 *
 * @param {Object} doc - Document Mongoose Document
 * @param {Buffer} fileBuffer 
 * @param {string} fileType 
 * @param {string} userId 
 */
export async function runVisionPipelineAsync(doc, fileBuffer, fileType, userId) {
  console.log(`[Vision] Starting background vision pipeline for document ${doc._id}`);

  if (!isVisionEnabled()) {
    console.log(`[Vision] Vision pipeline skipped for document ${doc._id} (VISION_ENABLED=false)`);
    doc.visionProcessingStatus = 'skipped';
    await doc.save();
    return;
  }

  doc.visionProcessingStatus = 'processing';
  await doc.save();

  try {
    // 1. Extract visual content
    const visualElements = await extractVisualContent(doc._id.toString(), fileBuffer, fileType);
    console.log(`[Vision] Found ${visualElements.length} visual elements in document ${doc._id}`);

    if (!visualElements || visualElements.length === 0) {
      doc.visionProcessingStatus = 'completed';
      doc.hasVisuals = false;
      doc.visualChunkCount = 0;
      await doc.save();
      return;
    }

    let storedCount = 0;

    // 2. Process each visual element independently
    for (const visualElem of visualElements) {
      try {
        console.log(`[Vision] Processing visual element ${visualElem.imageId}...`);
        
        // Generate semantic description
        const description = await describeVisualContent(visualElem);
        console.log(`[Vision] Generated description for ${visualElem.imageId}`);

        // Generate embedding vector
        const embedding = await generateVisualEmbedding(description, visualElem);
        console.log(`[Vision] Generated embedding vector for ${visualElem.imageId}`);

        // Store visual representation separately in visual_chunks collection
        await VisualChunk.create({
          userId,
          documentId: doc._id,
          pageNumber: visualElem.pageNumber || 1,
          imageId: visualElem.imageId,
          imageType: visualElem.imageType || 'image',
          imageUrl: visualElem.imageUrl,
          description,
          embedding,
          metadata: {
            boundingBox: visualElem.boundingBox,
            sourceLocation: visualElem.metadata
          }
        });

        storedCount++;
        console.log(`[Vision] Stored visual embedding for ${visualElem.imageId}`);
      } catch (elemErr) {
        console.error(`[Vision] Error processing visual element ${visualElem.imageId}: ${elemErr.message}`);
        // Continue processing remaining visual elements
      }
    }

    doc.visualChunkCount = storedCount;
    doc.hasVisuals = storedCount > 0;
    doc.visionProcessingStatus = 'completed';
    await doc.save();

    console.log(`[Vision] Background vision processing completed for document ${doc._id}. Stored ${storedCount} visual chunks.`);

  } catch (visionErr) {
    console.error(`[Vision] Vision pipeline failed for document ${doc._id}: ${visionErr.message}`);
    doc.visionProcessingStatus = 'failed';
    doc.visionError = visionErr.message;
    await doc.save();
    // Intentionally swallow error so overall document ingestion remains SUCCESS
  }
}
