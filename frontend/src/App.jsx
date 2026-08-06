import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Sidebar from './components/Sidebar';
import WebChat from './components/WebChat';
import WhatsAppChat from './components/WhatsAppChat';
import TelegramChat from './components/TelegramChat';
import Onboarding from './components/Onboarding';
import SettingsChannels from './components/SettingsChannels';

const rawBackendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || import.meta.env.VITE_APP_API_URL || 'http://localhost:5000';
const BACKEND_URL = rawBackendUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '');

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [onboarded, setOnboarded] = useState(() => {
    const val = localStorage.getItem('onboarded');
    return val === 'true';
  });
  const [isRegister, setIsRegister] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');

  const [activeView, setActiveView] = useState('web');
  const [webConversations, setWebConversations] = useState([]);
  const [whatsappConversations, setWhatsappConversations] = useState([]);
  const [telegramConversations, setTelegramConversations] = useState([]);

  const [activeWebConversation, setActiveWebConversation] = useState(null);
  const [activeWhatsappConversation, setActiveWhatsappConversation] = useState(null);
  const [activeTelegramConversation, setActiveTelegramConversation] = useState(null);

  const [webMessages, setWebMessages] = useState([]);
  const [whatsappMessages, setWhatsappMessages] = useState([]);
  const [telegramMessages, setTelegramMessages] = useState([]);

  const [channels, setChannels] = useState([]);
  const [socket, setSocket] = useState(null);
  const [typingStatus, setTypingStatus] = useState({});

  const [syncTrigger, setSyncTrigger] = useState(0);
  const syncTriggerRef = useRef(0);

  // Use refs so socket event handlers always have the latest state
  const activeWebConvRef = useRef(activeWebConversation);
  const activeWhatsappConvRef = useRef(activeWhatsappConversation);
  const activeTelegramConvRef = useRef(activeTelegramConversation);

  useEffect(() => { activeWebConvRef.current = activeWebConversation; }, [activeWebConversation]);
  useEffect(() => { activeWhatsappConvRef.current = activeWhatsappConversation; }, [activeWhatsappConversation]);
  useEffect(() => { activeTelegramConvRef.current = activeTelegramConversation; }, [activeTelegramConversation]);

  const getConversationsForView = () => {
    if (activeView === 'web') return webConversations;
    if (activeView === 'whatsapp') return whatsappConversations;
    if (activeView === 'telegram') return telegramConversations;
    return [];
  };

  const getActiveConversationForView = () => {
    if (activeView === 'web') return activeWebConversation;
    if (activeView === 'whatsapp') return activeWhatsappConversation;
    if (activeView === 'telegram') return activeTelegramConversation;
    return null;
  };

  const setActiveConversationForView = (conv) => {
    if (activeView === 'web') {
      setActiveWebConversation(conv);
      if (!conv) setWebMessages([]);
    } else if (activeView === 'whatsapp') {
      setActiveWhatsappConversation(conv);
      if (!conv) setWhatsappMessages([]);
    } else if (activeView === 'telegram') {
      setActiveTelegramConversation(conv);
      if (!conv) setTelegramMessages([]);
    }
  };

  const getMessagesForView = () => {
    if (activeView === 'web') return webMessages;
    if (activeView === 'whatsapp') return whatsappMessages;
    if (activeView === 'telegram') return telegramMessages;
    return [];
  };

  const setMessagesForView = (updater) => {
    if (activeView === 'web') setWebMessages(updater);
    else if (activeView === 'whatsapp') setWhatsappMessages(updater);
    else if (activeView === 'telegram') setTelegramMessages(updater);
  };

  // ── Auto Session Login (Direct access to Dashboard without Login / Onboarding) ──
  useEffect(() => {
    const autoAuthenticate = async () => {
      try {
        let guestKey = localStorage.getItem('qd_guest_key');
        if (!guestKey) {
          guestKey = 'guest_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
          localStorage.setItem('qd_guest_key', guestKey);
        }

        const res = await fetch(`${BACKEND_URL}/api/auth/auto-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guestKey })
        });
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('onboarded', 'true');
          setToken(data.token);
          setOnboarded(true);
        }
      } catch (err) {
        console.error('[AutoAuth] Failed to auto authenticate:', err);
      }
    };

    if (!token) {
      autoAuthenticate();
    }
  }, [token]);

  // ── Fetch data ────────────────────────────────────────
  const fetchData = async () => {
    if (!token || !onboarded) return;
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      const [webConvRes, waConvRes, tgConvRes, chanRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/conversations?channel=web`, { headers }),
        fetch(`${BACKEND_URL}/api/conversations?channel=whatsapp`, { headers }),
        fetch(`${BACKEND_URL}/api/conversations?channel=telegram`, { headers }),
        fetch(`${BACKEND_URL}/api/channels/status`, { headers })
      ]);

      setWebConversations(await webConvRes.json());
      setWhatsappConversations(await waConvRes.json());
      setTelegramConversations(await tgConvRes.json());
      setChannels(await chanRes.json());
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, onboarded, syncTrigger]);

  // ── Setup socket ────────────────────────────────────────
  useEffect(() => {
    if (!token || !onboarded) return;

    const newSocket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id);
      newSocket.emit('join', 'web');
      newSocket.emit('join', 'whatsapp');
      newSocket.emit('join', 'telegram');
    });

    newSocket.on('conversation:new', (newConv) => {
      if (newConv.channel === 'web') setWebConversations(prev => [newConv, ...prev]);
      else if (newConv.channel === 'whatsapp') setWhatsappConversations(prev => [newConv, ...prev]);
      else if (newConv.channel === 'telegram') setTelegramConversations(prev => [newConv, ...prev]);
    });

    newSocket.on('conversation:update', (updatedConv) => {
      const updateList = (prev) => {
        const filtered = prev.filter(c => c._id !== updatedConv._id);
        return [updatedConv, ...filtered];
      };
      if (updatedConv.channel === 'web') {
        setWebConversations(updateList);
        if (activeWebConvRef.current?._id === updatedConv._id) setActiveWebConversation(updatedConv);
      } else if (updatedConv.channel === 'whatsapp') {
        setWhatsappConversations(updateList);
        if (activeWhatsappConvRef.current?._id === updatedConv._id) setActiveWhatsappConversation(updatedConv);
      } else if (updatedConv.channel === 'telegram') {
        setTelegramConversations(updateList);
        if (activeTelegramConvRef.current?._id === updatedConv._id) setActiveTelegramConversation(updatedConv);
      }
    });

    // message:new — append to the active conversation's messages
    newSocket.on('message:new', (newMsg) => {
      const convId = newMsg.conversationId?._id || newMsg.conversationId;
      if (newMsg.channel === 'web') {
        if (activeWebConvRef.current?._id === convId) {
          setWebMessages(prev => {
            if (prev.some(m => m._id === newMsg._id)) return prev;
            return [...prev, newMsg];
          });
        }
      } else if (newMsg.channel === 'whatsapp') {
        if (activeWhatsappConvRef.current?._id === convId) {
          setWhatsappMessages(prev => {
            if (prev.some(m => m._id === newMsg._id)) return prev;
            return [...prev, newMsg];
          });
        }
      } else if (newMsg.channel === 'telegram') {
        if (activeTelegramConvRef.current?._id === convId) {
          setTelegramMessages(prev => {
            if (prev.some(m => m._id === newMsg._id)) return prev;
            return [...prev, newMsg];
          });
        }
      }
    });

    // message:update — update status of a specific message
    newSocket.on('message:update', (updatedMsg) => {
      const updater = (prev) =>
        prev.map(m => m._id === updatedMsg._id ? { ...m, ...updatedMsg } : m);
      if (updatedMsg.channel === 'web') setWebMessages(updater);
      else if (updatedMsg.channel === 'whatsapp') setWhatsappMessages(updater);
      else if (updatedMsg.channel === 'telegram') setTelegramMessages(updater);
    });

    newSocket.on('conversation:delete', ({ conversationId }) => {
      setWebConversations(prev => prev.filter(c => c._id !== conversationId));
      setWhatsappConversations(prev => prev.filter(c => c._id !== conversationId));
      setTelegramConversations(prev => prev.filter(c => c._id !== conversationId));
      setActiveWebConversation(prev => (prev?._id === conversationId) ? null : prev);
      setActiveWhatsappConversation(prev => (prev?._id === conversationId) ? null : prev);
      setActiveTelegramConversation(prev => (prev?._id === conversationId) ? null : prev);
    });

    newSocket.on('typing:start', ({ conversationId }) => {
      setTypingStatus(prev => ({ ...prev, [conversationId]: true }));
    });

    newSocket.on('typing:stop', ({ conversationId }) => {
      setTypingStatus(prev => ({ ...prev, [conversationId]: false }));
    });

    newSocket.on('channel:connected', ({ channel }) => {
      setChannels(prev => prev.map(c => c.channel === channel ? { ...c, connected: true } : c));
    });

    newSocket.on('channel:disconnected', ({ channel }) => {
      setChannels(prev => prev.map(c => c.channel === channel ? { ...c, connected: false } : c));
    });

    newSocket.on('messages:synced', ({ conversationId }) => {
      fetchData();
      const activeConv = activeTelegramConvRef.current || activeWhatsappConvRef.current || activeWebConvRef.current;
      if (activeConv && activeConv._id === conversationId) {
        syncTriggerRef.current += 1;
        setSyncTrigger(syncTriggerRef.current);
      }
    });

    return () => { newSocket.disconnect(); };
  }, [token, onboarded]);

  // ── Fetch messages when active conversation changes ───────────────────────────
  useEffect(() => {
    const activeConv = getActiveConversationForView();
    if (!token || !activeConv) return;

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/messages/${activeConv._id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setMessagesForView(data);
      } catch (err) {
        console.error('Error fetching messages:', err);
      }
    };

    fetchMessages();
  }, [activeWebConversation, activeWhatsappConversation, activeTelegramConversation, token, activeView, syncTrigger]);

  return (
    <div className="flex h-screen bg-[#171717] overflow-hidden text-zinc-100 font-sans">
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        conversations={getConversationsForView()}
        activeConversation={getActiveConversationForView()}
        setActiveConversation={setActiveConversationForView}
        channels={channels}
        token={token}
        backendUrl={BACKEND_URL}
      />

      <div className="flex flex-col flex-1 h-full overflow-hidden bg-[#212121]">
        {activeView === 'web' && (
          <WebChat
            token={token}
            activeConversation={getActiveConversationForView()}
            setActiveConversation={setActiveConversationForView}
            messages={getMessagesForView()}
            setMessages={setMessagesForView}
            typing={typingStatus[getActiveConversationForView()?._id] || false}
            backendUrl={BACKEND_URL}
          />
        )}
        {activeView === 'whatsapp' && (
          <WhatsAppChat
            token={token}
            activeConversation={getActiveConversationForView()}
            setActiveConversation={setActiveConversationForView}
            messages={getMessagesForView()}
            setMessages={setMessagesForView}
            typing={typingStatus[getActiveConversationForView()?._id] || false}
            channels={channels}
            backendUrl={BACKEND_URL}
          />
        )}
        {activeView === 'telegram' && (
          <TelegramChat
            token={token}
            activeConversation={getActiveConversationForView()}
            setActiveConversation={setActiveConversationForView}
            messages={getMessagesForView()}
            setMessages={setMessagesForView}
            typing={typingStatus[getActiveConversationForView()?._id] || false}
            channels={channels}
            backendUrl={BACKEND_URL}
          />
        )}
        {activeView === 'settings' && (
          <SettingsChannels
            token={token}
            backendUrl={BACKEND_URL}
            socket={socket}
            channels={channels}
            setSyncTrigger={setSyncTrigger}
          />
        )}
      </div>
    </div>
  );
}

export default App;
