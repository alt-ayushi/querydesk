import React, { useState } from 'react';
import {
  MessageSquare,
  MessageCircle,
  Send,
  LogOut,
  Plus,
  Search,
  Edit3,
  Trash2,
  Settings,
  Layers
} from 'lucide-react';
import DocumentModal from './DocumentModal';

function Sidebar({
  activeView,
  setActiveView,
  conversations,
  activeConversation,
  setActiveConversation,
  channels,
  token,
  backendUrl
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);

  const filteredConversations = conversations.filter(conv => {
    const matchesChannel = conv.channel === activeView;
    if (!matchesChannel) return false;

    const titleMatch = (conv.title || '').toLowerCase().includes(searchQuery.toLowerCase());
    const peerMatch = (conv.peerId || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (!titleMatch && !peerMatch) return false;

    if (activeView === 'whatsapp') {
      const whatsappStatus = channels.find(c => c.channel === 'whatsapp');
      if (!whatsappStatus || !whatsappStatus.connected || !whatsappStatus.phoneNumber) {
        return false;
      }
      const cleanConvPeer = conv.peerId.replace(/\D/g, '');
      const cleanConnectedPhone = whatsappStatus.phoneNumber.replace(/\D/g, '');
      // Compare last 10 digits to handle prefix variations reliably
      return cleanConvPeer.slice(-10) === cleanConnectedPhone.slice(-10);
    }

    if (activeView === 'telegram') {
      return true;
    }

    return true;
  });

  const getChannelIcon = (view) => {
    switch (view) {
      case 'web': return <MessageSquare className="h-4 w-4" />;
      case 'whatsapp': return <MessageCircle className="h-4 w-4" />;
      case 'telegram': return <Send className="h-4 w-4" />;
      default: return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getChannelStatusColor = (view) => {
    if (view === 'web') return 'bg-green-500';
    const channelInfo = channels.find(c => c.channel === view);
    return channelInfo?.connected ? 'bg-green-500' : 'bg-red-500';
  };

  const handleRename = async (id, currentTitle) => {
    const newTitle = window.prompt('Enter new title for conversation:', currentTitle);
    if (!newTitle || newTitle.trim() === '') return;
    try {
      const res = await fetch(`${backendUrl}/api/conversations/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });
      if (!res.ok) alert('Failed to rename conversation');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this conversation?')) return;
    try {
      const res = await fetch(`${backendUrl}/api/conversations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) alert('Failed to delete conversation');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col w-72 h-full bg-[#0d0d0d] border-r border-[#2d2d2d] select-none font-sans">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-[#2d2d2d]">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#10a37f] text-white text-md font-bold shadow-md shadow-[#10a37f]/10">
          Q
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold tracking-tight text-white">QueryDesk</span>
          <span className="text-[10px] text-zinc-400 font-medium">AI Multi-Channel Hub</span>
        </div>
      </div>

      {/* Channel Selectors */}
      <div className="grid grid-cols-3 gap-1 p-2 bg-[#171717] mx-3 mt-4 rounded-xl border border-[#2d2d2d]">
        {[
          { id: 'web', label: 'AI Chat' },
          { id: 'whatsapp', label: 'WhatsApp' },
          { id: 'telegram', label: 'Telegram' }
        ].map(item => (
          <button
            key={item.id}
            onClick={() => {
              setActiveView(item.id);
              setActiveConversation(null);
            }}
            className={`flex flex-col items-center justify-center py-2 rounded-lg transition-all duration-150 relative ${
              activeView === item.id
                ? 'bg-[#2a2a2a] text-[#10a37f]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              {getChannelIcon(item.id)}
              <span className={`absolute -top-1.5 -right-1.5 h-2 w-2 rounded-full border border-[#0d0d0d] ${getChannelStatusColor(item.id)}`} />
            </div>
            <span className="text-[10px] font-medium mt-1 uppercase tracking-wider">{item.label}</span>
          </button>
        ))}
      </div>

      {/* New Web Chat Button */}
      {activeView === 'web' && (
        <button
          onClick={() => setActiveConversation(null)}
          className="flex items-center justify-center gap-2 mx-3 mt-4 py-3 rounded-xl bg-gradient-to-r from-[#10a37f] to-[#0e8f6e] hover:brightness-110 text-white text-sm font-semibold shadow-lg shadow-[#10a37f]/15 transition duration-150"
        >
          <Plus className="h-4 w-4" /> New AI Chat
        </button>
      )}

      {/* Search */}
      <div className="relative mx-3 mt-4">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-zinc-500" />
        <input
          type="text"
          placeholder={`Search ${activeView === 'web' ? 'chats' : 'contacts'}...`}
          className="w-full rounded-xl bg-[#171717] border border-[#2d2d2d] pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#10a37f]"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto mt-4 px-2 space-y-1">
        {filteredConversations.length > 0 ? (
          filteredConversations.map(conv => {
            const isActive = activeConversation && activeConversation._id === conv._id;
            const unread = conv.unreadCount || 0;
            const lastMsgPreview = conv.lastMessage
              ? conv.lastMessage.slice(0, 32) + (conv.lastMessage.length > 32 ? '…' : '')
              : conv.peerId;

            return (
              <div
                key={conv._id}
                onClick={() => setActiveConversation(conv)}
                className={`flex items-center justify-between w-full p-3 rounded-xl transition duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-[#1a1a1a] border border-[#2d2d2d] text-white'
                    : 'text-zinc-400 hover:bg-[#121212] hover:text-zinc-200'
                }`}
              >
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold truncate text-zinc-200">
                      {conv.title}
                    </span>
                    {unread > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[#10a37f] text-white text-[9px] font-bold px-1">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                    {lastMsgPreview}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {activeView === 'web' && (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRename(conv._id, conv.title);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-[#10a37f] hover:bg-zinc-800 transition"
                        title="Rename"
                      >
                        <Edit3 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(conv._id);
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/30 transition"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <span className="text-[9px] text-zinc-500">
                    {conv.lastMessageAt
                      ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : ''}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center h-32 text-center text-zinc-500 px-4">
            <span className="text-xs">No active {activeView === 'web' ? 'conversations' : 'contacts'} found</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[#2d2d2d] bg-[#0d0d0d] flex flex-col gap-2">
        <button
          onClick={() => setIsDocModalOpen(true)}
          className="flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-700 hover:brightness-110 transition duration-150 shadow-md shadow-emerald-950/40"
        >
          <Layers className="h-4 w-4" /> Documents & Knowledge
        </button>

        <button
          onClick={() => {
            setActiveView('settings');
            setActiveConversation(null);
          }}
          className={`flex items-center gap-3 w-full p-2.5 rounded-xl text-xs font-medium transition duration-150 ${
            activeView === 'settings'
              ? 'bg-[#2a2a2a] text-[#10a37f] border border-[#2d2d2d]'
              : 'text-zinc-400 hover:bg-[#121212] hover:text-zinc-200'
          }`}
        >
          <Settings className="h-4 w-4" /> Channel Settings
        </button>
      </div>

      <DocumentModal
        isOpen={isDocModalOpen}
        onClose={() => setIsDocModalOpen(false)}
        token={token}
        backendUrl={backendUrl}
      />
    </div>
  );
}

export default Sidebar;
