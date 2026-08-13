import React, { useState, useEffect } from 'react';
import { Upload, FileText, Image as ImageIcon, CheckCircle, AlertCircle, Trash2, X, RefreshCw, Layers } from 'lucide-react';

function DocumentModal({ isOpen, onClose, token, backendUrl }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`${backendUrl}/api/documents`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
    }
  };

  useEffect(() => {
    if (isOpen) fetchDocuments();
  }, [isOpen]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return alert('Please select a file to upload');

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    if (title.trim()) formData.append('title', title);

    try {
      const res = await fetch(`${backendUrl}/api/documents/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }

      setTitle('');
      setSelectedFile(null);
      await fetchDocuments();
    } catch (err) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this document and all stored vector embeddings?')) return;
    try {
      const res = await fetch(`${backendUrl}/api/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchDocuments();
    } catch (err) {
      console.error(err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans">
      <div className="flex flex-col w-full max-w-3xl bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a] bg-[#121215]">
          <div className="flex items-center gap-2.5 text-white">
            <Layers className="h-5 w-5 text-[#10a37f]" />
            <h2 className="text-base font-bold">Multimodal Knowledge & Documents</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Upload Form */}
          <form onSubmit={handleUpload} className="p-4 bg-[#202023] border border-[#27272a] rounded-xl space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Upload PDF or Image Document</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Document Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-lg bg-[#141416] border border-[#27272a] px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#10a37f]"
              />
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="rounded-lg bg-[#141416] border border-[#27272a] px-3.5 py-1.5 text-xs text-zinc-300 file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-[#10a37f] file:text-white hover:file:bg-[#0e8f6e]"
              />
            </div>
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-semibold transition ${
                uploading || !selectedFile
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-[#10a37f] hover:bg-[#0e8f6e] text-white shadow-md shadow-[#10a37f]/20'
              }`}
            >
              <Upload className="h-4 w-4" /> {uploading ? 'Ingesting Document & Extracting Visuals...' : 'Upload & Process Document'}
            </button>
          </form>

          {/* Document List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Ingested Documents</h3>
              <button onClick={fetchDocuments} className="text-xs text-zinc-400 hover:text-[#10a37f] flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>

            {documents.length > 0 ? (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc._id} className="flex items-center justify-between p-3.5 bg-[#141416] border border-[#27272a] rounded-xl text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg bg-zinc-800 text-[#10a37f]">
                        {doc.fileType === 'image' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <span className="font-semibold text-white truncate block">{doc.title}</span>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5">
                          <span>{doc.textChunkCount || 0} Text Chunks</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-medium">{doc.visualChunkCount || 0} Visual Elements</span>
                          <span>•</span>
                          <span className="capitalize">{doc.status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                        doc.visionProcessingStatus === 'completed' ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50' :
                        doc.visionProcessingStatus === 'processing' ? 'bg-amber-950/60 text-amber-400 border border-amber-800/50' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        Vision: {doc.visionProcessingStatus}
                      </span>
                      <button onClick={() => handleDelete(doc._id)} className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-zinc-500 border border-dashed border-[#27272a] rounded-xl text-xs">
                No documents uploaded yet. Upload PDFs or images above to enable Multimodal RAG context!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DocumentModal;
