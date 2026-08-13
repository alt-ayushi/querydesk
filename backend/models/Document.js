import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  originalName: {
    type: String
  },
  fileType: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String
  },
  filePath: {
    type: String
  },
  size: {
    type: Number,
    default: 0
  },
  pageCount: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: ['uploading', 'processing', 'completed', 'failed'],
    default: 'processing'
  },
  textChunkCount: {
    type: Number,
    default: 0
  },
  visualChunkCount: {
    type: Number,
    default: 0
  },
  hasVisuals: {
    type: Boolean,
    default: false
  },
  visionProcessingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
    default: 'pending'
  },
  visionError: {
    type: String
  }
}, {
  timestamps: true
});

const Document = mongoose.model('Document', documentSchema);
export default Document;
