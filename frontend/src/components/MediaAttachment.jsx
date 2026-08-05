import React, { useState, useEffect } from 'react';
import { Image as ImageIcon, AlertCircle } from 'lucide-react';
import FormattedText from './FormattedText';

export default function MediaAttachment({ text, backendUrl, token }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [imgError, setImgError] = useState(false);
  const [loading, setLoading] = useState(false);

  // OpenClaw media placeholder format: [media attached: C:\...\image.jpg (image/jpeg)]
  const mediaRegex = /^\[media attached:\s*(.*?)\s*\((.*?)\)\]$/i;
  const match = text ? text.match(mediaRegex) : null;

  useEffect(() => {
    if (!match) return;

    const [, rawPath, mimeType] = match;
    if (!mimeType.startsWith('image/')) return;

    let objectUrl = null;

    const fetchMedia = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${backendUrl}/api/media?path=${encodeURIComponent(rawPath)}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch media');
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setImgUrl(objectUrl);
      } catch (err) {
        console.error('[MediaAttachment] Error fetching image:', err);
        setImgError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchMedia();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [text, backendUrl, token]);

  if (!text) return null;

  if (!match) {
    // If not a media placeholder, render formatted Markdown text
    return <FormattedText text={text} />;
  }

  const [, , mimeType] = match;

  // Render media inline if we matched the placeholder
  if (mimeType.startsWith('image/')) {
    if (imgError) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded-lg text-zinc-400">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <span className="text-xs italic">Image unavailable</span>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center h-32 w-32 bg-zinc-800/30 rounded-lg animate-pulse border border-zinc-700/50">
          <ImageIcon className="h-6 w-6 text-zinc-600" />
        </div>
      );
    }

    return (
      <div className="my-1 rounded-lg overflow-hidden border border-zinc-700/50">
        <img 
          src={imgUrl} 
          alt="Attached media" 
          onError={() => setImgError(true)}
          className="max-w-full max-h-[300px] object-contain"
        />
      </div>
    );
  }

  // Fallback for non-image media types (e.g. video, audio, docs)
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 rounded-lg text-zinc-300">
      <ImageIcon className="h-4 w-4" />
      <span className="text-xs italic">Media attached ({mimeType})</span>
    </div>
  );
}
