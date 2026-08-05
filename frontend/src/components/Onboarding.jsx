import React, { useState, useEffect } from 'react';
import { Phone, Bot, ArrowRight, Check, Loader2, Shield, AlertCircle } from 'lucide-react';

function Onboarding({ token, backendUrl, socket, onComplete }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);

  const [activeBotUsername, setActiveBotUsername] = useState('');

  useEffect(() => {
    // Fetch current channel status on mount to sync with backend
    const checkChannelStatus = async () => {
      if (!token) return;
      try {
        const res = await fetch(`${backendUrl}/api/channels/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) {
          // Token expired or invalid user in DB
          localStorage.removeItem('token');
          window.location.reload();
          return;
        }
        if (res.ok) {
          const sessions = await res.json();
          const wa = sessions.find(s => s.channel === 'whatsapp');
          const tg = sessions.find(s => s.channel === 'telegram');
          if (wa && wa.connected) setWhatsappConnected(true);
          if (tg && tg.connected) {
            setTelegramConnected(true);
            if (tg.botUsername) setActiveBotUsername(tg.botUsername);
          }
        }
      } catch (err) {
        console.error('Error fetching channel status during onboarding:', err);
      }
    };

    checkChannelStatus();

    if (!socket) return;

    socket.on('channel:qr', (data) => {
      if (data.channel === 'whatsapp') {
        setQrCode(data.qrCode);
        setLoading(false);
      }
    });

    socket.on('channel:connected', (data) => {
      if (data.channel === 'whatsapp') {
        setWhatsappConnected(true);
        setQrCode('');
        setLoading(false);
        setStep(4); // Move to Telegram connection step
      }
    });

    return () => {
      socket.off('channel:qr');
      socket.off('channel:connected');
    };
  }, [socket, token, backendUrl]);

  const handleGenerateWhatsAppQR = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleConnectTelegram = async (e) => {
    e.preventDefault();
    if (!telegramToken.trim()) return;
    setLoading(true);
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
      setTelegramConnected(true);
      setLoading(false);
      setStep(5); // Go to finished step
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/api/auth/onboard`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.ok) {
        onComplete();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#0d0d0d] px-4 font-sans select-none">
      <div className="w-full max-w-lg rounded-2xl bg-[#171717] border border-[#2d2d2d] p-8 shadow-2xl space-y-6 relative">
        {/* Skip All button in the top-right corner */}
        <button
          onClick={handleFinish}
          disabled={loading}
          className="absolute top-4 right-4 text-xs text-zinc-500 hover:text-zinc-300 font-semibold transition duration-150 disabled:opacity-50"
        >
          Skip All
        </button>
        
        {/* Step Indicator */}
        <div className="flex items-center justify-between text-xs text-zinc-500 uppercase tracking-wider font-semibold">
          <span>Onboarding Progress</span>
          <span>Step {step} of 5</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-[#10a37f] transition-all duration-300"
            style={{ width: `${(step / 5) * 100}%` }}
          />
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#10a37f]/10 text-[#10a37f]">
              <Shield className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Let's Connect Your Channels</h2>
              <p className="text-zinc-400 text-sm max-w-sm mx-auto leading-relaxed">
                Connect your WhatsApp and Telegram channels to begin managing conversations with your AI sales assistants.
              </p>
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#10a37f] py-3 text-sm font-semibold text-white shadow-lg shadow-[#10a37f]/20 transition duration-150 hover:bg-[#0e8f6e]"
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Step 2: Connect WhatsApp Card */}
        {step === 2 && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366]/10 text-[#25d366]">
              <Phone className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Link WhatsApp Account</h2>
              <p className="text-zinc-400 text-sm max-w-xs mx-auto">
                Scan the QR code to link your business or personal WhatsApp account.
              </p>
            </div>
            {error && (
              <div className="rounded-lg bg-red-950/30 border border-red-800 px-4 py-2 text-xs text-red-300 flex items-center gap-2 justify-center">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setStep(4)} // Skip to Telegram
                className="flex-1 rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition duration-150"
              >
                Skip WhatsApp
              </button>
              <button
                onClick={() => { setStep(3); handleGenerateWhatsAppQR(); }}
                className="flex-1 rounded-xl bg-[#10a37f] py-3 text-sm font-semibold text-white transition duration-150 hover:bg-[#0e8f6e]"
              >
                Generate QR Code
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Scan WhatsApp QR */}
        {step === 3 && (
          <div className="space-y-5 text-center">
            <h2 className="text-lg font-bold text-white">Scan the QR Code</h2>
            <p className="text-zinc-400 text-xs max-w-xs mx-auto">
              Open WhatsApp → Settings → Linked Devices → Link a Device.
            </p>
            
            <div className="flex justify-center bg-white p-4 rounded-xl border border-zinc-200 overflow-x-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-500 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-[#10a37f]" />
                  <span className="text-xs">Generating secure session...</span>
                </div>
              ) : qrCode ? (
                qrCode.startsWith('data:image/') ? (
                  <img src={qrCode} alt="WhatsApp QR Code" className="h-52 w-52 object-contain shadow-md rounded" />
                ) : (
                  <pre 
                    className="font-mono text-[6px] md:text-[8px] bg-white text-black leading-none select-none p-1 block whitespace-pre"
                    style={{ letterSpacing: '-1.5px', fontFamily: 'Courier New, monospace' }}
                  >
                    {qrCode}
                  </pre>
                )
              ) : (
                <div className="text-xs text-zinc-500 py-8">Waiting for QR code stream...</div>
              )}
            </div>

            <button
              onClick={() => setStep(4)} // Skip to Telegram
              className="w-full rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition duration-150"
            >
              Skip / Connect Later
            </button>
          </div>
        )}

        {/* Step 4: Connect Telegram Bot */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#35a8e0]/10 text-[#35a8e0]">
                <Bot className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-bold text-white">Link Telegram Bot</h2>
              <p className="text-zinc-400 text-sm max-w-xs mx-auto">
                {telegramConnected ? 'Your Telegram Bot is active and connected.' : 'Paste your Telegram Bot Token from @BotFather to link your Telegram channel.'}
              </p>
            </div>

            {telegramConnected && (
              <div className="rounded-xl bg-[#1e1e1e] border border-green-800/40 p-4 text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-xs font-semibold text-green-400">
                  <Check className="h-4 w-4" /> Telegram Bot Active
                </div>
                {activeBotUsername && (
                  <div className="text-xs text-zinc-300 font-mono">@{activeBotUsername.replace('@', '')}</div>
                )}
                <button
                  onClick={() => setStep(5)}
                  className="w-full mt-2 rounded-xl bg-[#10a37f] py-2.5 text-xs font-semibold text-white hover:bg-[#0e8f6e]"
                >
                  Continue to Next Step
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-950/30 border border-red-800 px-4 py-2 text-xs text-red-300 flex items-center gap-2 justify-center">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}

            {!telegramConnected && (
              <form onSubmit={handleConnectTelegram} className="space-y-4">
                <input
                  type="text"
                  required
                  className="w-full rounded-xl bg-[#262626] border border-[#3f3f46] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#10a37f]"
                  placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                />

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(5)} // Skip to finished step
                    className="flex-1 rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-zinc-400 hover:text-zinc-200 transition duration-150"
                  >
                    Skip Telegram
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !telegramToken.trim()}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#10a37f] py-3 text-sm font-semibold text-white transition duration-150 hover:bg-[#0e8f6e] disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect Bot'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Step 5: Finished */}
        {step === 5 && (
          <div className="space-y-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-500">
              <Check className="h-7 w-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Setup Completed!</h2>
              <p className="text-zinc-400 text-sm max-w-xs mx-auto leading-relaxed">
                Your channels are configured. You are ready to open the dashboard and manage your AI assistants.
              </p>
            </div>
            <button
              onClick={handleFinish}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#10a37f] py-3 text-sm font-semibold text-white shadow-lg shadow-[#10a37f]/20 transition duration-150 hover:bg-[#0e8f6e] disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Go to Dashboard'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default Onboarding;
