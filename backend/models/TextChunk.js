import mongoose from 'mongoose';

const textChunkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  pageNumber: {
    type: Number,
    default: 1
  },
  chunkIndex: {
    type: Number,
    default: 0
  },
  text: {
    type: String,
    required: true
  },
  embedding: {
    type: [Number],
    default: []
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'text_chunks'
});

const TextChunk = mongoose.model('TextChunk', textChunkSchema);
export default TextChunk;
