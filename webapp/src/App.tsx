import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wifi, Camera, ShieldAlert, ShieldCheck,
  Play, Square, Settings2, Hexagon, Mic, AlertTriangle,
  ArrowRight, Timer, Volume2, X, RefreshCw,
  Siren, CloudLightning, BellRing, Megaphone, Vibrate,
  ChevronRight, Radio, Zap
} from 'lucide-react';
import { cn } from './lib/utils';
import { useAudioMonitor } from './hooks/useAudioMonitor';

// ─── TYPES ───────────────────────────────────────────────────────
type AppScreen = 'welcome' | 'permissions' | 'discovery' | 'dashboard' | 'alert';
type StateLevel = 'idle' | 'monitoring' | 'detection' | 'alert';

interface LogItem {
  id: string;
  time: string;
  label: string;
  score: number;
}

interface AlertData {
  label: string;
  score: number;
  category: 'siren' | 'knock' | 'thunder' | 'government' | 'alarm' | 'unknown';
  timestamp: string;
}

const SOUND_CATEGORIES: Record<string, { icon: typeof Siren; color: string; bg: string; description: string }> = {
  siren:      { icon: Siren,          color: 'text-red-400',    bg: 'bg-red-500/15',    description: 'Emergency vehicle or alarm siren detected nearby' },
  knock:      { icon: BellRing,       color: 'text-amber-400',  bg: 'bg-amber-500/15',  description: 'Someone may be knocking at your door' },
  thunder:    { icon: CloudLightning, color: 'text-purple-400', bg: 'bg-purple-500/15', description: 'Thunderstorm activity detected' },
  government: { icon: Megaphone,      color: 'text-orange-400', bg: 'bg-orange-500/15', description: 'Public emergency broadcast or announcement' },
  alarm:      { icon: ShieldAlert,    color: 'text-red-500',    bg: 'bg-red-500/15',    description: 'Fire alarm or smoke detector triggered' },
  unknown:    { icon: Volume2,        color: 'text-slate-400',  bg: 'bg-slate-500/15',  description: 'Unclassified high-intensity sound event' },
};

const pageTransitionIn  = { opacity: 0, x: 50 };
const pageTransitionOut = { opacity: 0, x: -50 };
const pageAnimate       = { opacity: 1, x: 0 };
const pageTrans         = { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] };

// ─── APP ROOT ────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<AppScreen>('welcome');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [espIp, setEspIp]     = useState('');
  const [threshold, setThreshold] = useState(0.75);
  const [vibDuration, setVibDuration] = useState(60);
  const [alertData, setAlertData] = useState<AlertData | null>(null);

  useEffect(() => {
    setEspIp(localStorage.getItem('sensenet_ip') || '');
    setThreshold(parseFloat(localStorage.getItem('sensenet_threshold') || '0.75'));
    setVibDuration(parseInt(localStorage.getItem('sensenet_vib_duration') || '60'));
  }, []);

  const persist = useCallback((key: string, val: string) => localStorage.setItem(key, val), []);

  const triggerAlert = (data: AlertData) => { setAlertData(data); setScreen('alert'); };
  const dismissAlert = () => { setAlertData(null); setScreen('dashboard'); };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans tracking-tight bg-black">
      {/* Dot grid texture */}
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjAuNiIgZmlsbD0icmdiYSgyNTUsIDI1NSwgMjU1LCAwLjAzKSIvPjwvc3ZnPg==')] opacity-80 z-0 pointer-events-none" />

      <div className="w-full max-w-[440px] h-[100dvh] sm:h-[92vh] sm:rounded-3xl sm:border sm:border-white/8 relative overflow-hidden flex flex-col z-10 bg-bg shadow-2xl">
        <AnimatePresence mode="wait">
          {screen === 'welcome' && (
            <WelcomeScreen key="welcome" onStart={() => setScreen('permissions')} />
          )}
          {screen === 'permissions' && (
            <PermissionsScreen key="permissions" onContinue={() => setScreen('discovery')} />
          )}
          {screen === 'discovery' && (
            <DiscoveryScreen
              key="discovery"
              espIp={espIp}
              setEspIp={ip => { setEspIp(ip); persist('sensenet_ip', ip); }}
              onContinue={() => setScreen('dashboard')}
            />
          )}
          {screen === 'dashboard' && (
            <DashboardScreen
              key="dashboard"
              espIp={espIp}
              threshold={threshold}
              setThreshold={t => { setThreshold(t); persist('sensenet_threshold', String(t)); }}
              vibDuration={vibDuration}
              setVibDuration={d => { setVibDuration(d); persist('sensenet_vib_duration', String(d)); }}
              onOpenSettings={() => setSettingsOpen(true)}
              onAlert={triggerAlert}
            />
          )}
          {screen === 'alert' && alertData && (
            <AlertScreen
              key="alert"
              data={alertData}
              duration={vibDuration}
              espIp={espIp}
              onDismiss={dismissAlert}
            />
          )}
        </AnimatePresence>

        {/* Settings Overlay */}
        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              espIp={espIp}
              setEspIp={ip => { setEspIp(ip); persist('sensenet_ip', ip); }}
              threshold={threshold}
              setThreshold={t => { setThreshold(t); persist('sensenet_threshold', String(t)); }}
              vibDuration={vibDuration}
              setVibDuration={d => { setVibDuration(d); persist('sensenet_vib_duration', String(d)); }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── SCREEN 1: WELCOME ──────────────────────────────────────────
function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      initial={pageTransitionIn}
      animate={pageAnimate}
      exit={pageTransitionOut}
      transition={pageTrans}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      {/* Ambient */}
      <div className="absolute top-[-25%] left-[-15%] w-[70%] h-[50%] bg-brand/15 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-20%] w-[60%] h-[40%] bg-brand/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex-1 flex flex-col justify-center px-8 relative z-10">
        {/* Hero */}
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.7 }}
        >
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3.5 bg-brand/15 rounded-2xl border border-brand/25">
              <Hexagon className="w-9 h-9 text-brand" fill="currentColor" />
            </div>
            <span className="text-2xl font-bold tracking-wide text-white">SenseNet</span>
          </div>

          <h1 className="text-[2.2rem] font-bold text-white leading-[1.15] mb-5 tracking-tight">
            Stay aware of your<br />surroundings.
          </h1>
          <p className="text-[15px] text-slate-400 leading-relaxed max-w-[340px]">
            Even when you cannot hear them. This system detects
            dangerous sounds and alerts you through a wearable
            vibration device.
          </p>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-12"
        >
          <button
            onClick={onStart}
            className="w-full flex items-center justify-between bg-white text-black font-bold py-5 px-7 rounded-2xl active:scale-[0.97] transition-transform shadow-lg shadow-white/8"
          >
            <span className="text-[15px]">Start Setup</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </motion.div>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-center text-[10px] text-slate-600 pb-8 px-8 font-mono"
      >
        SENSENET v2.0 · HACKATHON 2026
      </motion.p>
    </motion.div>
  );
}

// ─── SCREEN 2: PERMISSIONS ───────────────────────────────────────
function PermissionsScreen({ onContinue }: { onContinue: () => void }) {
  const [micOk, setMicOk]   = useState(false);
  const [camOk, setCamOk]   = useState(false);
  const [denied, setDenied] = useState(false);

  const grantAll = async () => {
    setDenied(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(t => t.stop());
      setMicOk(true);
      setCamOk(true);
      setTimeout(onContinue, 600); // brief delay for visual feedback
    } catch {
      setDenied(true);
      // Try individually to show partial progress
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: true });
        a.getTracks().forEach(t => t.stop());
        setMicOk(true);
      } catch { /* mic denied */ }
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: true });
        v.getTracks().forEach(t => t.stop());
        setCamOk(true);
      } catch { /* cam denied */ }
    }
  };

  const allGranted = micOk && camOk;

  return (
    <motion.div
      initial={pageTransitionIn}
      animate={pageAnimate}
      exit={pageTransitionOut}
      transition={pageTrans}
      className="flex-1 flex flex-col justify-center px-8 relative z-10"
    >
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Setup Required</h2>
        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
          SenseNet requires the following to detect sounds and notify your wristband.
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="space-y-3 mb-6"
      >
        {/* Permission Items */}
        {[
          { icon: Mic, label: 'Microphone access', ok: micOk, desc: 'Listen for dangerous sounds' },
          { icon: Camera, label: 'Camera access', ok: camOk, desc: 'Capture visual context on alert' },
          { icon: Wifi, label: 'Wi-Fi connectivity', ok: true, desc: 'Communicate with wristband' },
        ].map((item, i) => (
          <div key={i} className={cn(
            "flex items-center gap-4 p-4 rounded-2xl border transition-all",
            item.ok ? "bg-safe/8 border-safe/20" : "bg-white/3 border-white/8"
          )}>
            <div className={cn("p-2.5 rounded-xl", item.ok ? "bg-safe/15 text-safe" : "bg-white/5 text-slate-500")}>
              <item.icon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="text-xs text-slate-500">{item.ok ? 'Ready ✓' : item.desc}</p>
            </div>
          </div>
        ))}
      </motion.div>

      {denied && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-danger/10 border border-danger/20 rounded-xl p-3 mb-4"
        >
          <p className="text-xs text-danger-light font-medium">
            Permissions denied. Please allow access in your browser settings and try again.
          </p>
        </motion.div>
      )}

      <motion.div
        initial={{ y: 15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="frosted rounded-xl p-4 mb-6"
      >
        <p className="text-xs text-slate-400 leading-relaxed">
          <Wifi className="w-3.5 h-3.5 inline mr-1.5 text-brand" />
          Make sure your phone is on the <strong className="text-white">same WiFi network</strong> as the ESP32 wristband.
        </p>
      </motion.div>

      {allGranted ? (
        <button
          onClick={onContinue}
          className="w-full py-4 rounded-2xl font-bold bg-white text-black active:scale-[0.97] transition-transform shadow-lg"
        >
          Continue
        </button>
      ) : (
        <button
          onClick={grantAll}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold bg-brand text-white active:scale-[0.97] transition-transform shadow-lg shadow-brand/20"
        >
          Grant Permissions
        </button>
      )}
    </motion.div>
  );
}

// ─── SCREEN 3: DEVICE DISCOVERY ──────────────────────────────────
function DiscoveryScreen({ espIp, setEspIp, onContinue }: {
  espIp: string; setEspIp: (ip: string) => void; onContinue: () => void;
}) {
  const [phase, setPhase] = useState<'scanning' | 'found' | 'manual'>('scanning');

  useEffect(() => {
    // Simulate scan — your teammate's backend handles real scanning
    const t = setTimeout(() => setPhase('found'), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={pageTransitionIn}
      animate={pageAnimate}
      exit={pageTransitionOut}
      transition={pageTrans}
      className="flex-1 flex flex-col justify-center px-8 relative z-10"
    >
      <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">Connecting to Wristband</h2>
        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
          {phase === 'scanning' ? 'Searching for nearby device...' :
           phase === 'found' ? 'Device discovered on your network.' :
           'Enter your device IP manually.'}
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 15, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="frosted rounded-2xl p-6 mb-6"
      >
        {phase === 'scanning' && (
          <div className="text-center py-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              className="w-14 h-14 mx-auto mb-5 border-2 border-brand/20 border-t-brand rounded-full"
            />
            <p className="text-sm text-slate-400 font-medium">Scanning network...</p>
            <p className="text-[10px] text-slate-600 mt-2 font-mono">UDP BROADCAST 255.255.255.255</p>
          </div>
        )}

        {phase === 'found' && (
          <div className="text-center py-4">
            <div className="w-14 h-14 bg-safe/15 rounded-full flex items-center justify-center mx-auto mb-4">
              <Radio className="w-7 h-7 text-safe" />
            </div>
            <p className="text-base font-bold text-white mb-1">ESP32 Wristband</p>
            <p className="text-sm text-slate-400 font-mono">
              IP: {espIp || '192.168.1.24'}
            </p>
            <div className="flex items-center justify-center gap-1.5 mt-3">
              <div className="w-2 h-2 rounded-full bg-safe animate-pulse" />
              <span className="text-xs text-safe font-bold">CONNECTED</span>
            </div>
          </div>
        )}

        {phase === 'manual' && (
          <div className="py-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">
              Device IP Address
            </label>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white font-mono focus:outline-none focus:border-brand/40 transition-colors"
              placeholder="192.168.1.xxx"
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
              autoFocus
            />
          </div>
        )}
      </motion.div>

      <div className="space-y-3">
        {phase !== 'scanning' && (
          <button
            onClick={() => {
              if (!espIp) setEspIp('192.168.1.24');
              onContinue();
            }}
            className="w-full py-4 rounded-2xl font-bold bg-white text-black active:scale-[0.97] transition-transform shadow-lg"
          >
            {phase === 'found' ? 'Connect' : 'Continue'}
          </button>
        )}

        {phase === 'found' && (
          <button
            onClick={() => setPhase('manual')}
            className="w-full py-3 text-sm text-slate-500 font-medium"
          >
            Enter IP manually instead
          </button>
        )}

        {phase === 'scanning' && (
          <button
            onClick={() => setPhase('manual')}
            className="w-full py-3 text-sm text-slate-500 font-medium"
          >
            Skip — Enter IP manually
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── SCREEN 4: MONITORING DASHBOARD ──────────────────────────────
function DashboardScreen({ espIp, threshold, setThreshold, vibDuration, setVibDuration, onOpenSettings, onAlert }: {
  espIp: string;
  threshold: number;
  setThreshold: (t: number) => void;
  vibDuration: number;
  setVibDuration: (d: number) => void;
  onOpenSettings: () => void;
  onAlert: (data: AlertData) => void;
}) {
  const [systemState, setSystemState] = useState<StateLevel>('idle');
  const [detectedSound, setDetectedSound] = useState('None');
  const [confidence, setConfidence] = useState(0);
  const [logs, setLogs] = useState<LogItem[]>([]);

  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasSnap, setHasSnap] = useState(false);

  const { startMonitoring, stopMonitoring, isMonitoring, level } = useAudioMonitor(threshold, () => {});

  const handleToggle = () => {
    if (isMonitoring) {
      setSystemState('idle');
      setDetectedSound('None');
      setConfidence(0);
      stopMonitoring();
    } else {
      setSystemState('monitoring');
      startMonitoring();
    }
  };

  const pushLog = (label: string, score: number) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
    setLogs(prev => [{ id: crypto.randomUUID(), time, label, score }, ...prev].slice(0, 20));
  };

  const snapFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = ms;
      videoRef.current.play();
      setTimeout(() => {
        if (!videoRef.current || !canvasRef.current) return;
        canvasRef.current.width  = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        canvasRef.current.getContext('2d')?.drawImage(videoRef.current, 0, 0);
        ms.getTracks().forEach(t => t.stop());
        setHasSnap(true);
      }, 600);
    } catch (e) { console.error('Camera snap failed:', e); }
  };

  const triggerEvent = async (label: string, score: number, category: AlertData['category']) => {
    if (systemState === 'alert') return;
    const ts = new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setSystemState('alert');
    setDetectedSound(label);
    setConfidence(score);
    pushLog(label, score);
    await snapFrame();

    if (espIp) fetch(`http://${espIp}/alert`, { mode: 'no-cors' }).catch(() => {});

    onAlert({ label, score, category, timestamp: ts });
  };

  // State → header color
  const headerBg = systemState === 'alert'
    ? 'bg-danger' : systemState === 'detection'
    ? 'bg-warn' : systemState === 'monitoring'
    ? 'bg-brand' : 'bg-surface';

  const VIB_OPTIONS = [15, 30, 60, 120];

  return (
    <motion.div
      initial={pageTransitionIn}
      animate={pageAnimate}
      exit={pageTransitionOut}
      transition={pageTrans}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      {/* Header */}
      <header className={cn("shrink-0 px-5 py-4 flex items-center justify-between z-40 transition-colors duration-500", headerBg)}>
        <div className="flex items-center gap-2.5">
          <Hexagon className="w-5 h-5 text-white" fill="currentColor" />
          <div>
            <span className="text-sm font-bold text-white block leading-tight">SenseNet Monitoring</span>
            <span className="text-[10px] text-white/60 font-mono">
              {espIp ? `Device: ${espIp}` : 'No device'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass-pill px-2.5 py-1 rounded-full flex items-center gap-1.5">
            <motion.div
              animate={systemState === 'alert' ? { scale: [1, 1.4, 1] } : {}}
              transition={{ repeat: Infinity, duration: 0.6 }}
              className={cn("w-2 h-2 rounded-full",
                systemState === 'monitoring' ? 'bg-blue-300' :
                systemState === 'detection'  ? 'bg-amber-300' :
                systemState === 'alert'      ? 'bg-white' :
                'bg-slate-500'
              )}
            />
            <span className="text-[9px] font-bold text-white uppercase tracking-widest">{systemState}</span>
          </div>
          <button onClick={onOpenSettings} className="p-2 rounded-full bg-white/10 active:scale-90 transition-transform">
            <Settings2 className="w-4 h-4 text-white" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-8">

        {/* ── Sound Activity Meter ── */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] flex items-center gap-2">
              <Mic className="w-3.5 h-3.5" /> Sound Activity
            </h2>
            {isMonitoring && <span className="text-[10px] text-brand font-bold meter-live">LIVE</span>}
          </div>
          <div className="h-7 bg-black/40 rounded-lg overflow-hidden border border-white/5 p-0.5">
            <motion.div
              className={cn(
                "h-full rounded-md transition-colors duration-300",
                level > 80 ? "bg-danger shadow-[0_0_15px_var(--color-danger)]" :
                level > 50 ? "bg-warn shadow-[0_0_10px_var(--color-warn)]" :
                "bg-brand shadow-[0_0_10px_var(--color-brand)]"
              )}
              animate={{ width: `${Math.max(2, level)}%` }}
              transition={{ type: 'spring', bounce: 0, duration: 0.15 }}
            />
          </div>
        </section>

        {/* ── Detection Result ── */}
        <section className="frosted rounded-2xl p-4">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Detected Sound</h2>
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-white">{detectedSound}</p>
            {confidence > 0 && (
              <span className={cn(
                "font-mono font-bold text-sm px-2 py-0.5 rounded-md",
                confidence >= threshold ? "bg-danger/20 text-danger-light" : "bg-white/10 text-white"
              )}>
                {confidence.toFixed(2)}
              </span>
            )}
          </div>
          {confidence > 0 && (
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">Confidence</p>
          )}
        </section>

        {/* ── Monitoring Control ── */}
        <section className="frosted rounded-2xl p-6 flex flex-col items-center text-center">
          <button
            onClick={handleToggle}
            className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 shadow-xl mb-3",
              isMonitoring
                ? "bg-danger text-white shadow-danger/25"
                : "bg-white text-black shadow-white/15"
            )}
          >
            {isMonitoring
              ? <Square className="w-9 h-9" fill="currentColor" />
              : <Play className="w-9 h-9 ml-0.5" fill="currentColor" />
            }
          </button>
          <p className="font-bold text-white text-base">
            {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {isMonitoring ? 'Microphone active · AI classifier running' : 'Tap to begin listening'}
          </p>
        </section>

        {/* ── Alert Sensitivity ── */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">Alert Sensitivity</h2>
            <span className="text-brand font-mono font-bold text-sm">Threshold: {threshold.toFixed(2)}</span>
          </div>
          <input
            type="range" min="0.50" max="0.95" step="0.01"
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            className="w-full cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-1">
            <span>0.50 (sensitive)</span>
            <span>0.95 (strict)</span>
          </div>
        </section>

        {/* ── Vibration Duration ── */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" /> Vibration Duration
            </h2>
            <span className="text-amber-400 font-mono font-bold text-sm">{vibDuration}s</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">Auto-stops vibration after this time.</p>
          <div className="grid grid-cols-4 gap-2">
            {VIB_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => setVibDuration(s)}
                className={cn(
                  "py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95",
                  vibDuration === s
                    ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                    : "bg-white/4 text-slate-500 border border-white/8 hover:bg-white/8"
                )}
              >
                {s}s
              </button>
            ))}
          </div>
        </section>

        {/* ── Camera Snapshot ── */}
        <section className="frosted rounded-2xl p-4">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] flex items-center gap-2 mb-3">
            <Camera className="w-3.5 h-3.5" /> Last Camera Snapshot
          </h2>
          <div className="aspect-[4/3] bg-black/50 rounded-xl border border-white/5 overflow-hidden flex items-center justify-center">
            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas ref={canvasRef} className={cn("w-full h-full object-cover", !hasSnap && "hidden")} />
            {!hasSnap && <span className="text-xs text-slate-600 font-medium">Awaiting trigger...</span>}
          </div>
        </section>

        {/* ── Demo Simulations ── */}
        <section className="frosted rounded-2xl p-4 border border-dashed border-amber-500/25">
          <h2 className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.15em] mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Demo Simulations
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Fire Alarm',  score: 0.94, cat: 'alarm' as const,   emoji: '🔥' },
              { label: 'Siren',       score: 0.91, cat: 'siren' as const,   emoji: '🚨' },
              { label: 'Door Knock',  score: 0.87, cat: 'knock' as const,   emoji: '🚪' },
              { label: 'Thunder',     score: 0.82, cat: 'thunder' as const, emoji: '⛈️' },
            ].map(sim => (
              <button
                key={sim.label}
                onClick={() => triggerEvent(sim.label, sim.score, sim.cat)}
                className="py-3 rounded-xl bg-white/3 border border-white/8 text-slate-300 font-bold text-xs active:scale-95 transition-all hover:bg-white/6"
              >
                {sim.emoji} {sim.label}
              </button>
            ))}
          </div>
        </section>

        {/* ── Detection Log ── */}
        <section className="frosted rounded-2xl p-4">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Detection Log</h2>
          <div className="bg-black/30 rounded-xl overflow-hidden border border-white/5">
            <ul className="max-h-[220px] overflow-y-auto">
              {logs.length === 0 ? (
                <li className="p-4 text-center text-xs text-slate-600 italic">No events yet.</li>
              ) : logs.map((log, i) => (
                <li key={log.id} className={cn(
                  "px-4 py-3 flex items-center justify-between border-b border-white/5 last:border-0",
                  i === 0 && "bg-white/3"
                )}>
                  <div>
                    <p className="text-sm text-white font-medium">{log.label}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{log.time}</p>
                  </div>
                  <span className={cn(
                    "text-xs font-mono font-bold px-2 py-0.5 rounded-md",
                    log.score >= threshold ? "bg-danger/20 text-danger-light" : "bg-white/8 text-slate-400"
                  )}>
                    {log.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

// ─── SCREEN 5: SETTINGS PANEL ────────────────────────────────────
function SettingsPanel({ espIp, setEspIp, threshold, setThreshold, vibDuration, setVibDuration, onClose }: {
  espIp: string;
  setEspIp: (ip: string) => void;
  threshold: number;
  setThreshold: (t: number) => void;
  vibDuration: number;
  setVibDuration: (d: number) => void;
  onClose: () => void;
}) {
  const VIB_OPTIONS = [15, 30, 60, 120];
  const [testPulse, setTestPulse] = useState(false);

  const testWristband = async () => {
    setTestPulse(true);
    if (espIp) {
      fetch(`http://${espIp}/test`, { mode: 'no-cors' }).catch(() => {});
    }
    setTimeout(() => setTestPulse(false), 2000);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50"
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="absolute top-0 right-0 bottom-0 w-[88%] bg-bg border-l border-white/8 z-50 flex flex-col"
      >
        <div className="p-5 border-b border-white/8 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Settings</h2>
          <button onClick={onClose} className="p-2 rounded-full bg-white/5 active:scale-90 transition-transform">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Device Settings */}
          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5" /> Device Settings
            </h3>
            <label className="text-xs text-slate-400 mb-1.5 block">ESP32 IP Address</label>
            <input
              className="w-full bg-white/5 border border-white/8 rounded-xl px-4 py-3.5 text-white font-mono text-sm focus:outline-none focus:border-brand/40 transition-colors"
              placeholder="192.168.1.xxx"
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
            />
          </div>

          {/* Alert Settings */}
          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">Alert Settings</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs text-slate-400">Sensitivity Threshold</label>
                  <span className="text-brand font-mono font-bold text-sm">{threshold.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0.5" max="0.95" step="0.01"
                  value={threshold}
                  onChange={e => setThreshold(parseFloat(e.target.value))}
                  className="w-full cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs text-slate-400">Vibration Duration</label>
                  <span className="text-amber-400 font-mono font-bold text-sm">{vibDuration}s</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {VIB_OPTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => setVibDuration(s)}
                      className={cn(
                        "py-2 rounded-lg font-bold text-xs transition-all active:scale-95",
                        vibDuration === s
                          ? "bg-amber-500 text-black"
                          : "bg-white/5 text-slate-500 border border-white/8"
                      )}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Hardware */}
          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3 flex items-center gap-2">
              <Vibrate className="w-3.5 h-3.5" /> Hardware
            </h3>
            <button
              onClick={testWristband}
              disabled={testPulse}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-xl border transition-all active:scale-[0.98]",
                testPulse ? "bg-safe/10 border-safe/25" : "bg-white/3 border-white/8"
              )}
            >
              <div className="flex items-center gap-3">
                <Vibrate className={cn("w-5 h-5", testPulse ? "text-safe" : "text-slate-400")} />
                <span className="text-sm font-semibold text-white">
                  {testPulse ? 'Pulsing...' : 'Test Wristband'}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          {/* System */}
          <div>
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em] mb-3">System</h3>
            <button className="w-full flex items-center justify-between p-4 rounded-xl bg-white/3 border border-white/8 active:scale-[0.98] transition-all mb-2">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-slate-400" />
                <span className="text-sm font-semibold text-white">Reconnect Device</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          {/* About */}
          <div className="frosted rounded-xl p-4 text-center">
            <ShieldCheck className="w-8 h-8 text-brand mx-auto mb-2" />
            <p className="text-[10px] text-slate-500 font-mono">SENSENET v2.0 · BUILD 2026.03.14</p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── SCREEN 6: ALERT ─────────────────────────────────────────────
function AlertScreen({ data, duration, espIp, onDismiss }: {
  data: AlertData; duration: number; espIp: string; onDismiss: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(duration);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) { clearInterval(timer); onDismiss(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [duration]);

  const catInfo = SOUND_CATEGORIES[data.category] || SOUND_CATEGORIES.unknown;
  const CatIcon = catInfo.icon;
  const progress = ((duration - secondsLeft) / duration) * 100;
  const circumference = 2 * Math.PI * 52;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      {/* Pulsing overlay */}
      <motion.div
        animate={{ opacity: [0.12, 0.28, 0.12] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="absolute inset-0 bg-danger pointer-events-none z-0"
      />

      {/* Header */}
      <div className="relative z-10 shrink-0 flex items-center justify-between px-5 py-4">
        <span className="text-[10px] font-bold text-white/70 uppercase tracking-[0.2em] animate-pulse">
          ⚠ ALERT DETECTED
        </span>
        <button onClick={onDismiss} className="p-2 bg-white/10 rounded-full active:scale-90 transition-transform">
          <X className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center relative z-10">

        {/* Icon */}
        <motion.div
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-5 shadow-2xl shadow-white/15"
        >
          <CatIcon className="w-12 h-12 text-danger" />
        </motion.div>

        {/* Sound Info */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl px-5 py-3 mb-3 border border-white/15">
          <p className="text-[9px] text-white/50 uppercase tracking-[0.2em] mb-1">Sound Type</p>
          <p className="text-2xl font-bold text-white">{data.label}</p>
        </div>

        <p className={cn("text-sm font-bold mb-1", catInfo.color)}>
          Confidence: {data.score.toFixed(2)}
        </p>
        <p className="text-xs text-white/40 mb-1">Time: {data.timestamp}</p>
        <p className="text-xs text-white/40 max-w-[280px] mb-5 leading-relaxed">{catInfo.description}</p>

        {/* Countdown Ring */}
        <div className="relative w-28 h-28 mb-5">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
            <motion.circle
              cx="60" cy="60" r="52" fill="none" stroke="white" strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress / 100)}
              transition={{ duration: 0.5 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-3xl font-mono font-bold text-white leading-none">{secondsLeft}</p>
            <p className="text-[8px] text-white/40 uppercase tracking-widest mt-1">seconds</p>
          </div>
        </div>

        <p className="text-[11px] text-white/35 mb-5 font-mono">
          Wristband vibrating · Auto-stops in {secondsLeft}s
        </p>

        {/* Actions */}
        <div className="w-full max-w-[300px] space-y-2">
          <button
            onClick={onDismiss}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold text-base active:scale-[0.97] transition-transform shadow-xl"
          >
            I'm Awake
          </button>
          <button
            onClick={onDismiss}
            className="w-full py-3 rounded-xl text-white/50 text-sm font-medium"
          >
            Continue Monitoring
          </button>
        </div>
      </div>
    </motion.div>
  );
}
