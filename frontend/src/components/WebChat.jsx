import React, { useState, useEffect, useRef } from 'react';
import { Send, User, Bot, CornerDownLeft, Sparkles, Loader2, Paperclip, X, Image as ImageIcon, FileText } from 'lucide-react';
import MediaAttachment from './MediaAttachment';

function WebChat({
  token,
  activeConversation,
  setActiveConversation,
  messages,
  setMessages,
  typing,
  backendUrl
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Suggestions for empty chat
  const suggestions = [
    "Draft a professional reply to a customer complaint",
    "Explain what is a WebSocket and how it differs from HTTP",
    "Write a JavaScript script to fetch and format JSON data",
    "How do I set up a Telegram bot using BotFather?"
  ];

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typing]);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const clearImageSelection = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (textToSend) => {
    const text = textToSend !== undefined ? textToSend : input;
    const currentImage = imagePreview;

    if ((!text.trim() && !currentImage) || loading) return;

    setInput('');
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setLoading(true);

    // ── IMAGE SEND PATH ─────────────────────────────────────────────────────
    if (currentImage) {
      const tempUserMsg = {
        _id: 'temp-user-' + Date.now(),
        conversationId: activeConversation?._id || 'temp-conv',
        text: text || 'Describe this image.',
        messageType: 'image',
        imageUrl: currentImage,
        role: 'user',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, tempUserMsg]);

      try {
        const res = await fetch(`${backendUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            message: text || 'Describe this image.',
            image: currentImage,
            conversationId: activeConversation?._id
          })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to send image');
        }

        const data = await res.json();
        if (data.conversationId && !activeConversation) {
          setActiveConversation({
            _id: data.conversationId,
            title: (text || 'Image Query').slice(0, 30),
            channel: 'web',
            peerId: 'web-new',
            lastMessageAt: new Date()
          });
        }

        if (data.assistantMessage) {
          setMessages(prev => [...prev, data.assistantMessage]);
        }
      } catch (err) {
        console.error('[WebChat] Image send error:', err);
        setMessages(prev => [...prev, {
          _id: 'err-' + Date.now(),
          conversationId: activeConversation?._id || 'temp-conv',
          text: "I couldn't process that image. Please try again.",
          role: 'assistant',
          timestamp: new Date()
        }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── TEXT STREAM SEND PATH (UNTOUCHED) ──────────────────────────────────
    const tempUserMsg = {
      _id: 'temp-user-' + Date.now(),
      conversationId: activeConversation?._id || 'temp-conv',
      text: text,
      role: 'user',
      timestamp: new Date()
    };

    const tempAssistantMsg = {
      _id: 'temp-assistant-' + Date.now(),
      conversationId: activeConversation?._id || 'temp-conv',
      text: '',
      role: 'assistant',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg]);

    try {
      const res = await fetch(`${backendUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: text,
          conversationId: activeConversation?._id
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to send message');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          const dataText = line.substring(6);

          if (dataText.trim() === '[DONE]') {
            break;
          }

          try {
            const parsed = JSON.parse(dataText);
            if (parsed.conversationId) {
              if (!activeConversation) {
                setActiveConversation({
                  _id: parsed.conversationId,
                  title: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
                  channel: 'web',
                  peerId: 'web-new',
                  lastMessageAt: new Date()
                });
              }
              if (parsed.visualSources && parsed.visualSources.length > 0) {
                tempAssistantMsg.visualSources = parsed.visualSources;
              }
            } else if (parsed.chunk) {
              tempAssistantMsg.text = (tempAssistantMsg.text || '') + parsed.chunk;
              setMessages(prev => prev.map(m => m._id === tempAssistantMsg._id ? { ...tempAssistantMsg } : m));
            } else if (parsed.error) {
              tempAssistantMsg.text = `Error: ${parsed.error}`;
              setMessages(prev => prev.map(m => m._id === tempAssistantMsg._id ? { ...tempAssistantMsg } : m));
            }
          } catch (e) {
            // Ignore partial parse failures
          }
        }
      }
    } catch (err) {
      console.error(err);
      tempAssistantMsg.text = `Error: ${err.message}`;
      setMessages(prev => prev.map(m => m._id === tempAssistantMsg._id ? { ...tempAssistantMsg } : m));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-[#212121] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d2d2d] bg-[#1f1f1f]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#10a37f]" />
          <span className="text-sm font-semibold tracking-wide text-zinc-100">
            {activeConversation ? activeConversation.title : 'New AI Conversation'}
          </span>
        </div>
        <div className="text-xs text-zinc-400">
          Powered by QueryDesk Common AI
        </div>
      </div>

      {/* Messages / Welcome Screen */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {!activeConversation && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center space-y-8 select-none">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1f1f1f] border border-[#2d2d2d] shadow-lg">
              <Sparkles className="h-8 w-8 text-[#10a37f]" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight text-white">How can I help you today?</h1>
              <p className="text-sm text-zinc-400">Start typing below, upload an image 📎, or select a prompt to begin.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              {suggestions.map((s, index) => (
                <button
                  key={index}
                  onClick={() => handleSend(s)}
                  className="flex flex-col justify-between text-left p-4 rounded-xl bg-[#1e1e1e] hover:bg-[#252525] border border-[#2d2d2d] hover:border-[#10a37f]/50 transition duration-150"
                >
                  <span className="text-xs font-medium text-zinc-200">{s}</span>
                  <span className="text-[10px] text-zinc-500 mt-3 self-end flex items-center gap-1 font-semibold">
                    Try this <CornerDownLeft className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div 
                  key={msg._id || index} 
                  className={`flex gap-4 ${isAssistant ? '' : 'justify-end'}`}
                >
                  {isAssistant && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#10a37f]/10 border border-[#10a37f]/20 text-[#10a37f]">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div className={`flex flex-col max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                    isAssistant 
                      ? 'bg-[#1e1e1e] border border-[#2d2d2d] text-zinc-200 rounded-tl-none' 
                      : 'bg-[#10a37f] text-white rounded-tr-none'
                  }`}>
                    {/* Render Image Attachment if present */}
                    {msg.imageUrl && (
                      <div className="mb-2 overflow-hidden rounded-xl border border-zinc-700/50">
                        <img 
                          src={msg.imageUrl} 
                          alt="Uploaded attachment" 
                          className="max-h-60 max-w-full object-contain rounded-lg"
                        />
                      </div>
                    )}

                    {/* Render Document Attachment Card if present */}
                    {(msg.fileName || msg.messageType === 'document') && (
                      <div className="mb-2 flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/10 text-white">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/30 text-red-300">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold truncate">{msg.fileName || 'Document Attachment'}</span>
                          <span className="text-[10px] text-zinc-300">PDF Document</span>
                        </div>
                      </div>
                    )}
                    <MediaAttachment text={msg.text || msg.message} backendUrl={backendUrl} token={token} />

                    {/* Render Visual Evidence Cards if present */}
                    {msg.visualSources && msg.visualSources.length > 0 && (
                      <div className="mt-3 p-2.5 rounded-xl bg-[#141416] border border-emerald-800/50 space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                          <Sparkles className="h-3 w-3" /> Visual Source Evidence
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {msg.visualSources.map((vSrc, vIdx) => (
                            <div key={vIdx} className="flex flex-col p-2 bg-[#1b1b1e] border border-[#27272a] rounded-lg text-xs space-y-1">
                              {vSrc.imageUrl && (
                                <img src={vSrc.imageUrl} alt={vSrc.documentTitle} className="h-36 w-full object-contain rounded bg-[#0d0d0e]" />
                              )}
                              <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1">
                                <span className="font-semibold text-zinc-200 truncate">{vSrc.documentTitle}</span>
                                <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono">Page {vSrc.pageNumber}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <span className={`text-[9px] mt-1.5 self-end ${isAssistant ? 'text-zinc-500' : 'text-[#e6fcf5]'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {!isAssistant && (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a] border border-[#3f3f46] text-zinc-300">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              );
            })}

            {/* AI Typing Indicator */}
            {(typing || loading) && (
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#10a37f]/10 border border-[#10a37f]/20 text-[#10a37f]">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1.5 bg-[#1e1e1e] border border-[#2d2d2d] rounded-2xl rounded-tl-none px-4 py-3.5">
                  <span className="h-2 w-2 rounded-full bg-[#10a37f] animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 rounded-full bg-[#10a37f] animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 rounded-full bg-[#10a37f] animate-bounce" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="p-4 bg-[#1f1f1f] border-t border-[#2d2d2d]">
        <div className="max-w-3xl mx-auto space-y-2">
          
          {/* Image Thumbnail Preview Bar */}
          {imagePreview && (
            <div className="relative inline-flex items-center gap-2 p-2 bg-[#262626] border border-[#3f3f46] rounded-xl shadow-md">
              <img src={imagePreview} alt="Selected preview" className="h-16 w-16 object-cover rounded-lg" />
              <div className="flex flex-col pr-6">
                <span className="text-xs font-medium text-zinc-200">Image attached</span>
                <span className="text-[10px] text-zinc-400">Ready to send with prompt</span>
              </div>
              <button
                onClick={clearImageSelection}
                className="absolute top-1.5 right-1.5 p-1 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition"
                title="Remove image"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="relative flex items-center">
            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              className="hidden"
            />

            {/* Paperclip Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute left-3 p-2 text-zinc-400 hover:text-[#10a37f] transition duration-150"
              title="Attach Image"
            >
              <Paperclip className="h-4.5 w-4.5" />
            </button>

            <textarea
              className="w-full rounded-2xl bg-[#262626] border border-[#3f3f46] pl-12 pr-12 py-3.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#10a37f] resize-none max-h-32"
              rows="1"
              placeholder={imagePreview ? "Type an optional question about this image..." : "Type your message here..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
            />

            <button
              onClick={() => handleSend()}
              disabled={(!input.trim() && !imagePreview) || loading}
              className={`absolute right-2.5 p-2 rounded-xl transition duration-150 ${
                (input.trim() || imagePreview) && !loading
                  ? 'bg-[#10a37f] text-white hover:bg-[#0e8f6e]'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WebChat;
