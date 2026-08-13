import mongoose from 'mongoose';

const visualChunkSchema = new mongoose.Schema({
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
  imageId: {
    type: String,
    required: true
  },
  imageType: {
    type: String,
    enum: ['image', 'chart', 'graph', 'diagram', 'table', 'figure', 'screenshot'],
    default: 'image'
  },
  imageUrl: {
    type: String
  },
  description: {
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
  collection: 'visual_chunks'
});

const VisualChunk = mongoose.model('VisualChunk', visualChunkSchema);
export default VisualChunk;
