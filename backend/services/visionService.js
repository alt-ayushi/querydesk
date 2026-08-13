/**
 * visionService.js
 *
 * Modular Vision Processing Service abstraction.
 * Decouples model technology (Mistral Vision / Pixtral, CLIP, ColPali, etc.) from QueryDesk core RAG.
 */

import { generateVisionAIResponse } from './aiService.js';
import { generateEmbedding } from './embeddingService.js';

export function isVisionEnabled() {
  const envVal = process.env.VISION_ENABLED;
  return envVal !== 'false' && envVal !== '0';
}

/**
 * Detects and extracts visual elements (images, charts, diagrams, tables) from a document buffer.
 * If file is an image (png, jpg, webp), returns the image as page 1.
 * If file is a PDF or document, scans for embedded image streams or renders visual pages.
 *
 * @param {string} documentId 
 * @param {Buffer} fileBuffer 
 * @param {string} fileType ('pdf' | 'image' | 'png' | 'jpeg' | 'jpg')
 * @returns {Promise<Array<Object>>} Extracted visual elements
 */
export async function extractVisualContent(documentId, fileBuffer, fileType = 'pdf') {
  console.log(`[Vision] Extracting visual content for document ${documentId} (Type: ${fileType})`);
  const visualElements = [];

  try {
    const isImg = fileType.includes('image') || fileType.includes('png') || fileType.includes('jpg') || fileType.includes('jpeg');

    if (isImg && fileBuffer) {
      const mimeType = fileType.includes('png') ? 'image/png' : 'image/jpeg';
      const base64Data = fileBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      visualElements.push({
        imageId: `img_${documentId}_p1_1`,
        pageNumber: 1,
        imageType: 'image',
        imageUrl: dataUrl,
        boundingBox: { pageNumber: 1, x: 0, y: 0, width: 100, height: 100 },
        metadata: {
          mimeType,
          sizeBytes: fileBuffer.length
        }
      });
      console.log(`[Vision] Extracted 1 primary image element from uploaded image document`);
      return visualElements;
    }

    // For PDF files: scan buffer for embedded JPEG/PNG image headers or data streams
    if (fileType.includes('pdf') && fileBuffer) {
      const bufferStr = fileBuffer.toString('latin1');
      let imgCount = 0;
      
      // Look for PDF image XObjects (/Subtype /Image)
      const matches = bufferStr.match(/\/Subtype\s*\/Image/g);
      const totalImagesInPdf = matches ? matches.length : 0;
      console.log(`[Vision] Found ${totalImagesInPdf} embedded visual stream markers in PDF`);

      // Extract image blocks or page references
      // Search for JPG starts (\xFF\xD8\xFF) and PNG starts (\x89PNG) in PDF stream
      let searchOffset = 0;
      while (imgCount < 10) {
        const jpgStart = fileBuffer.indexOf(Buffer.from([0xFF, 0xD8, 0xFF]), searchOffset);
        const pngStart = fileBuffer.indexOf(Buffer.from([0x89, 0x50, 0x4E, 0x47]), searchOffset);

        if (jpgStart === -1 && pngStart === -1) break;

        let startPos = -1;
        let isPng = false;

        if (jpgStart !== -1 && (pngStart === -1 || jpgStart < pngStart)) {
          startPos = jpgStart;
          isPng = false;
        } else {
          startPos = pngStart;
          isPng = true;
        }

        searchOffset = startPos + 4;

        // Find end marker
        let endPos = -1;
        if (!isPng) {
          endPos = fileBuffer.indexOf(Buffer.from([0xFF, 0xD9]), startPos + 4);
          if (endPos !== -1) endPos += 2;
        } else {
          endPos = fileBuffer.indexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]), startPos + 8);
          if (endPos !== -1) endPos += 8;
        }

        if (endPos > startPos && (endPos - startPos) > 1000) { // filter out tiny icons (<1KB)
          imgCount++;
          const imgBuf = fileBuffer.subarray(startPos, endPos);
          const mime = isPng ? 'image/png' : 'image/jpeg';
          const base64 = imgBuf.toString('base64');
          const pageNum = Math.min(imgCount, 20); // estimate page number

          visualElements.push({
            imageId: `img_${documentId}_p${pageNum}_${imgCount}`,
            pageNumber: pageNum,
            imageType: 'diagram',
            imageUrl: `data:${mime};base64,${base64}`,
            boundingBox: { pageNumber: pageNum, x: 10, y: 10, width: 80, height: 80 },
            metadata: { mimeType: mime, sizeBytes: imgBuf.length }
          });
        }
      }

      console.log(`[Vision] Successfully extracted ${visualElements.length} visual objects from PDF`);
    }

  } catch (err) {
    console.warn(`[Vision] Extraction non-fatal error: ${err.message}`);
  }

  return visualElements;
}

/**
 * Generates a rich semantic description of a visual element using the vision LLM.
 * Identifies whether it is a diagram, chart, graph, figure, table, or architecture view.
 *
 * @param {Object} visualElement 
 * @returns {Promise<string>} Detailed text description
 */
export async function describeVisualContent(visualElement) {
  if (!isVisionEnabled()) {
    console.log('[Vision] Vision processing disabled via VISION_ENABLED config');
    return 'Visual content description skipped (Vision disabled).';
  }

  if (!visualElement || !visualElement.imageUrl) {
    return 'No visual data available.';
  }

  console.log(`[Vision] Generating semantic description for imageId ${visualElement.imageId}`);

  const prompt = `Perform a comprehensive visual analysis of this document element. 
Identify if this is an architecture diagram, flowchart, graph, bar chart, screenshot, data table, or technical figure. 
Describe all visible components, nodes, connections, data trends, titles, text labels, and structural details in exact depth so it can be retrieved via text query.`;

  try {
    const description = await generateVisionAIResponse([], visualElement.imageUrl, prompt);
    console.log(`[Vision] Generated semantic description (${description.length} chars) for ${visualElement.imageId}`);
    return description;
  } catch (err) {
    console.error(`[Vision] Description generation failed for ${visualElement.imageId}: ${err.message}`);
    // Return fallback description to prevent pipeline failure
    return `Visual element on page ${visualElement.pageNumber} (${visualElement.imageType || 'diagram'}). Description unavailable due to vision model error.`;
  }
}

/**
 * Generates a visual embedding vector for visual content / visual description.
 *
 * @param {string} description 
 * @param {Object} visualElement 
 * @returns {Promise<Array<number>>} Vector embedding
 */
export async function generateVisualEmbedding(description, visualElement) {
  const compositeText = `[Visual ${visualElement?.imageType || 'Element'} Page ${visualElement?.pageNumber || 1}] ${description || ''}`;
  return await generateEmbedding(compositeText);
}
