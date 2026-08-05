import React, { useState, useEffect } from 'react';
import { Phone, Bot, Check, Loader2, RefreshCw, XCircle, AlertCircle } from 'lucide-react';

function SettingsChannels({ token, backendUrl, socket, channels, setSyncTrigger }) {
  const [loading, setLoading] = useState({});
  const [error, setError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [showTelegramInput, setShowTelegramInput] = useState(false);

  const whatsappStatus = channels.find(c => c.channel === 'whatsapp');
  const telegramStatus = channels.find(c => c.channel === 'telegram');

  useEffect(() => {
    if (!socket) return;

    socket.on('channel:qr', (data) => {
      if (data.channel === 'whatsapp') {
        setQrCode(data.qrCode);
        setLoading(prev => ({ ...prev, whatsapp: false }));
      }
    });

    socket.on('channel:connected', (data) => {
      setSyncTrigger(prev => prev + 1);
      if (data.channel === 'whatsapp') {
        setQrCode('');
        setLoading(prev => ({ ...prev, whatsapp: false }));
      }
    });

    socket.on('channel:disconnected', (data) => {
      setSyncTrigger(prev => prev + 1);
    });

    socket.on('channel:error', (data) => {
      if (data.channel === 'whatsapp') {
        setError(data.reason || 'WhatsApp connection failed.');
        setLoading(prev => ({ ...prev, whatsapp: false }));
      }
    });

    return () => {
      socket.off('channel:qr');
      socket.off('channel:connected');
      socket.off('channel:disconnected');
      socket.off('channel:error');
    };
  }, [socket]);

  const handleConnectWhatsApp = async () => {
    setLoading(prev => ({ ...prev, whatsapp: true }));
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/channels/whatsapp/connect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start WhatsApp connection');
    } catch (err) {
      setError(err.message);
      setLoading(prev => ({ ...prev, whatsapp: false }));
    }
  };

  const handleDisconnect = async (channel) => {
    setLoading(prev => ({ ...prev, [channel]: true }));
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/channels/${channel}/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to disconnect ${channel}`);
      setSyncTrigger(prev => prev + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(prev => ({ ...prev, [channel]: false }));
    }
  };

  const handleConnectTelegram = async (e) => {
    e.preventDefault();
    if (!telegramToken.trim()) return;
    setLoading(prev => ({ ...prev, telegram: true }));
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/channels/telegram/connect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: telegramToken.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to connect Telegram Bot');
      setTelegramToken('');
      setShowTelegramInput(false);
      setSyncTrigger(prev => prev + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(prev => ({ ...prev, telegram: false }));
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-[#121212] overflow-y-auto px-8 py-6 space-y-6">
      
      {/* Header */}
      <div className="border-b border-[#2d2d2d] pb-4">
        <h1 className="text-xl font-bold text-white">Channel Settings</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Manage your connected WhatsApp and Telegram accounts and configure integrations.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-950/30 border border-red-800 px-4 py-3 text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-4.5 w-4.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
        
        {/* WhatsApp Channel Card */}
        <div className="rounded-xl border border-[#2d2d2d] bg-[#171717] p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#25d366]/10 text-[#25d366]">
                  <Phone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">WhatsApp Integration</h3>
                  <p className="text-[10px] text-zinc-400">Scan QR to sync device</p>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-semibold">
                <span className={`h-1.5 w-1.5 rounded-full ${whatsappStatus?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-zinc-300 uppercase tracking-wider">
                  {whatsappStatus?.connected ? 'Active' : 'Offline'}
                </span>
              </div>
            </div>

            {whatsappStatus?.connected && (
              <div className="rounded-lg bg-zinc-900 border border-[#2d2d2d] p-3 space-y-1">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Connected Number</div>
                <div className="text-xs text-zinc-300 font-mono">{whatsappStatus.phoneNumber || 'Unknown'}</div>
              </div>
            )}

            {/* Render QR code if generating */}
            {qrCode && !whatsappStatus?.connected && (
              <div className="flex flex-col items-center gap-2 p-4 bg-white rounded-lg border border-zinc-200 mt-2">
                <span className="text-[10px] text-zinc-500 font-semibold mb-2">Scan with WhatsApp:</span>
                {qrCode.startsWith('data:image/') ? (
                  <img src={qrCode} alt="WhatsApp QR Code" className="h-48 w-48 object-contain shadow-md rounded" />
                ) : (
                  <pre 
                    className="font-mono text-[6px] md:text-[8px] bg-white text-black leading-none select-none p-1 block whitespace-pre"
                    style={{ letterSpacing: '-1.5px', fontFamily: 'Courier New, monospace' }}
                  >
                    {qrCode}
                  </pre>
                )}
              </div>
            )}
          </div>

          <div className="pt-2 flex gap-3">
            {whatsappStatus?.connected ? (
              <button
                onClick={() => handleDisconnect('whatsapp')}
                disabled={loading.whatsapp}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-red-800 bg-red-950/20 text-xs font-semibold text-red-300 py-2.5 transition hover:bg-red-950/45 disabled:opacity-50"
              >
                {loading.whatsapp ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
              </button>
            ) : (
              <button
                onClick={handleConnectWhatsApp}
                disabled={loading.whatsapp}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#10a37f] text-xs font-semibold text-white py-2.5 transition hover:bg-[#0e8f6e] disabled:opacity-50"
              >
                {loading.whatsapp ? <Loader2 className="h-4 w-4 animate-spin" /> : qrCode ? 'Regenerate QR' : 'Connect Account'}
              </button>
            )}
          </div>
        </div>

        {/* Telegram Channel Card */}
        <div className="rounded-xl border border-[#2d2d2d] bg-[#171717] p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#35a8e0]/10 text-[#35a8e0]">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Telegram Bot</h3>
                  <p className="text-[10px] text-zinc-400">Connect using Bot token</p>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-semibold">
                <span className={`h-1.5 w-1.5 rounded-full ${telegramStatus?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-zinc-300 uppercase tracking-wider">
                  {telegramStatus?.connected ? 'Active' : 'Offline'}
                </span>
              </div>
            </div>

            {telegramStatus?.connected && (
              <div className="rounded-lg bg-zinc-900 border border-[#2d2d2d] p-3 space-y-1">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Bot Username</div>
                <div className="text-xs text-zinc-300 font-mono">
                  {telegramStatus.botUsername ? (telegramStatus.botUsername.startsWith('@') ? telegramStatus.botUsername : `@${telegramStatus.botUsername}`) : '@Kltele_bot'}
                </div>
              </div>
            )}

            {/* Token entry form */}
            {showTelegramInput && !telegramStatus?.connected && (
              <form onSubmit={handleConnectTelegram} className="space-y-3 pt-2">
                <input
                  type="text"
                  required
                  className="w-full rounded-lg bg-[#262626] border border-[#3f3f46] px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#10a37f]"
                  placeholder="Bot Token from @BotFather"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTelegramInput(false)}
                    className="flex-1 rounded-lg bg-zinc-800 py-2 text-xs font-semibold text-zinc-400 transition hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading.telegram}
                    className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-[#10a37f] text-xs font-semibold text-white py-2 transition hover:bg-[#0e8f6e] disabled:opacity-50"
                  >
                    {loading.telegram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Connect'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {!showTelegramInput && (
            <div className="pt-2 flex gap-3">
              {telegramStatus?.connected ? (
                <button
                  onClick={() => handleDisconnect('telegram')}
                  disabled={loading.telegram}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-red-800 bg-red-950/20 text-xs font-semibold text-red-300 py-2.5 transition hover:bg-red-950/45 disabled:opacity-50"
                >
                  {loading.telegram ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
                </button>
              ) : (
                <button
                  onClick={() => setShowTelegramInput(true)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#10a37f] text-xs font-semibold text-white py-2.5 transition hover:bg-[#0e8f6e]"
                >
                  Connect Bot
                </button>
              )}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

export default SettingsChannels;
