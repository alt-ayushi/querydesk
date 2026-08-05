import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, User, AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import MediaAttachment from './MediaAttachment';

// Message delivery status indicator
function StatusIcon({ status }) {
  if (status === 'pending') return <Clock className="h-3 w-3 text-zinc-500" />;
  if (status === 'sent') return <Check className="h-3 w-3 text-zinc-400" />;
  if (status === 'delivered') return <CheckCheck className="h-3 w-3 text-zinc-400" />;
  if (status === 'read') return <CheckCheck className="h-3 w-3 text-[#53bdeb]" />;
  if (status === 'failed') return <AlertCircle className="h-3 w-3 text-red-400" />;
  return null;
}

function TelegramChat({
  token,
  activeConversation,
  setActiveConversation,
  messages,
  setMessages,
  typing,
  channels,
  backendUrl
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const telegramStatus = channels.find(c => c.channel === 'telegram');

  const scrollToBottom = (behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => { scrollToBottom(); }, [messages, typing]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || !activeConversation || loading) return;

    setLoading(true);
    const text = input.trim();
    setInput('');

    try {
      const res = await fetch(`${backendUrl}/api/channels/telegram/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          target: activeConversation.peerId,
          message: text,
          conversationId: activeConversation._id
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send message');
    } catch (err) {
      console.error('[TelegramChat] Send error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Helper to get message display text
  const getMsgText = (msg) => msg.text || msg.message || '';

  return (
    <div className="flex flex-col flex-1 h-full bg-[#182533] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#101921] bg-[#1f2c3a]">
        {activeConversation ? (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 text-zinc-300">
              <User className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-zinc-100">{activeConversation.title}</span>
              <span className="text-xs text-zinc-400">ID: {activeConversation.peerId}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-[#35a8e0]" />
            <span className="text-sm font-semibold tracking-wide text-zinc-100">Telegram Bot Dashboard</span>
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${telegramStatus?.connected ? 'bg-green-500 shadow-md shadow-green-500/25' : 'bg-red-500'}`} />
            {telegramStatus?.connected ? (
              <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-800 rounded-lg text-zinc-300 max-w-[150px] sm:max-w-xs truncate" title={telegramStatus.botUsername}>
                {telegramStatus.botUsername ? (telegramStatus.botUsername.startsWith('@') ? telegramStatus.botUsername : `@${telegramStatus.botUsername}`) : '@Kltele_bot'}
              </span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-900 rounded-lg text-zinc-500">
                Not Connected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {activeConversation ? (
          <div className="max-w-3xl mx-auto space-y-3">
            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant';
              const isFailed = msg.status === 'failed';
              return (
                <div
                  key={msg._id || index}
                  className={`flex ${isAssistant ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex flex-col max-w-[70%] rounded-xl px-4 py-2.5 text-sm shadow-sm ${
                    isAssistant
                      ? isFailed
                        ? 'bg-red-950/60 border border-red-800 text-red-200 rounded-tr-none'
                        : 'bg-[#2b5278] text-white rounded-tr-none'
                      : 'bg-[#182533] border border-[#233140] text-zinc-100 rounded-tl-none'
                  }`}>
                    <MediaAttachment text={getMsgText(msg)} backendUrl={backendUrl} token={token} />
                    <div className="flex items-center justify-end gap-1 mt-1">
                      {isFailed && (
                        <span className="text-[9px] text-red-400 mr-1">Failed to deliver</span>
                      )}
                      <span className="text-[9px] text-zinc-400">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isAssistant && <StatusIcon status={msg.status} />}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {typing && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 bg-[#182533] border border-[#233140] rounded-xl rounded-tl-none px-4 py-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center space-y-4 select-none">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900 border border-[#2d2d2d] shadow-lg">
              <Bot className="h-8 w-8 text-[#35a8e0]" />
            </div>
            <h2 className="text-xl font-bold text-white">QueryDesk Telegram Dashboard</h2>
            <p className="text-sm text-zinc-400">
              Select a conversation from the sidebar to view messages or send a reply.
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      {activeConversation && (
        <div className="p-4 bg-[#1f2c3a] border-t border-[#101921]">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 rounded-xl bg-[#263546] border border-[#37475a] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#35a8e0] resize-none overflow-hidden"
              placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className={`shrink-0 p-3 rounded-xl transition duration-150 ${
                input.trim() && !loading
                  ? 'bg-[#2b5278] text-white hover:brightness-110'
                  : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TelegramChat;
