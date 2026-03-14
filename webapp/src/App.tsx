import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Wifi, Camera, ShieldAlert, ShieldCheck, 
  Play, Square, Settings2, Hexagon, Mic, AlertTriangle,
  User, ArrowRight, Fingerprint, Eye, EyeOff, Timer, Volume2, 
  Siren, CloudLightning, BellRing, Megaphone, X
} from 'lucide-react';
import { cn } from './lib/utils';
import { useAudioMonitor } from './hooks/useAudioMonitor';

// ========================================
// TYPES
// ========================================
type AppScreen = 'welcome' | 'permissions' | 'discovery' | 'dashboard' | 'alert';
type StateLevel = 'idle' | 'monitoring' | 'alert';

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
}

const SOUND_CATEGORIES: Record<string, { icon: typeof Siren, color: string, description: string }> = {
  siren: { icon: Siren, color: 'text-red-400', description: 'Emergency vehicle or alarm siren detected nearby' },
  knock: { icon: BellRing, color: 'text-amber-400', description: 'Someone may be knocking at your door' },
  thunder: { icon: CloudLightning, color: 'text-purple-400', description: 'Thunderstorm activity detected' },
  government: { icon: Megaphone, color: 'text-orange-400', description: 'Public emergency broadcast or announcement' },
  alarm: { icon: ShieldAlert, color: 'text-red-500', description: 'Fire alarm or smoke detector triggered' },
  unknown: { icon: Volume2, color: 'text-slate-400', description: 'Unclassified high-intensity sound event' },
};

// ========================================
// MAIN APP: Screen Router
// ========================================
export default function App() {
  const [screen, setScreen] = useState<AppScreen>('welcome');
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Shared state
  const [espIp, setEspIp] = useState('');
  const [threshold, setThreshold] = useState(0.75);
  const [userName, setUserName] = useState('User');
  const [vibrationDuration, setVibrationDuration] = useState(60); // seconds
  const [alertData, setAlertData] = useState<AlertData | null>(null);

  useEffect(() => {
    const ip = localStorage.getItem('sensenet_ip') || '';
    const th = localStorage.getItem('sensenet_threshold') || '0.75';
    const name = localStorage.getItem('sensenet_user') || 'User';
    const vd = localStorage.getItem('sensenet_vib_duration') || '60';
    setEspIp(ip);
    setThreshold(parseFloat(th));
    setUserName(name);
    setVibrationDuration(parseInt(vd));
  }, []);

  const handleTriggerAlert = (data: AlertData) => {
    setAlertData(data);
    setScreen('alert');
  };

  return (
    <div className="min-h-screen flex items-center justify-center font-sans tracking-tight bg-black">
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wNCkiLz48L3N2Zz4=')] opacity-60 z-0 pointer-events-none" />
      
      <div className="w-full max-w-[440px] h-[100dvh] sm:h-[92vh] sm:rounded-3xl sm:border sm:border-white/10 relative overflow-hidden flex flex-col z-10 bg-bg shadow-2xl">
        <AnimatePresence mode="wait">
          {screen === 'welcome' && (
            <WelcomeScreen
              key="welcome"
              onLogin={(name) => { setUserName(name); localStorage.setItem('sensenet_user', name); setScreen('permissions'); }}
              onGuest={() => setScreen('permissions')}
            />
          )}
          {screen === 'permissions' && (
            <PermissionsScreen key="permissions" onContinue={() => setScreen('discovery')} />
          )}
          {screen === 'discovery' && (
            <DiscoveryScreen
              key="discovery"
              espIp={espIp}
              setEspIp={(ip) => { setEspIp(ip); localStorage.setItem('sensenet_ip', ip); }}
              onContinue={() => setScreen('dashboard')}
            />
          )}
          {screen === 'dashboard' && (
            <DashboardScreen
              key="dashboard"
              userName={userName}
              espIp={espIp}
              threshold={threshold}
              setThreshold={(t) => { setThreshold(t); localStorage.setItem('sensenet_threshold', String(t)); }}
              vibrationDuration={vibrationDuration}
              setVibrationDuration={(d) => { setVibrationDuration(d); localStorage.setItem('sensenet_vib_duration', String(d)); }}
              onOpenSettings={() => setSettingsOpen(true)}
              onAlert={handleTriggerAlert}
            />
          )}
          {screen === 'alert' && alertData && (
            <AlertScreen
              key="alert"
              alertData={alertData}
              duration={vibrationDuration}
              onDismiss={() => { setScreen('dashboard'); setAlertData(null); }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              espIp={espIp}
              setEspIp={(ip) => { setEspIp(ip); localStorage.setItem('sensenet_ip', ip); }}
              threshold={threshold}
              setThreshold={(t) => { setThreshold(t); localStorage.setItem('sensenet_threshold', String(t)); }}
              vibrationDuration={vibrationDuration}
              setVibrationDuration={(d) => { setVibrationDuration(d); localStorage.setItem('sensenet_vib_duration', String(d)); }}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ========================================
// SCREEN 1: WELCOME / LOGIN
// ========================================
function WelcomeScreen({ onLogin, onGuest }: { onLogin: (name: string) => void, onGuest: () => void }) {
  const [showLogin, setShowLogin] = useState(false);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.4 }}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      <div className="absolute top-[-30%] left-[-20%] w-[80%] h-[60%] bg-brand/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[50%] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="flex-1 flex flex-col justify-center px-8 relative z-10">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-brand/20 rounded-2xl border border-brand/30">
              <Hexagon className="w-8 h-8 text-brand" fill="currentColor" />
            </div>
            <span className="text-2xl font-bold tracking-wide text-white">SenseNet</span>
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-3">
            Hello there! 👋
          </h1>
          <p className="text-base text-slate-400 leading-relaxed">
            Your assistive safety companion. <br/>Stay protected with real-time acoustic awareness.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {!showLogin ? (
            <motion.div
              key="options"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="space-y-4"
            >
              <button
                onClick={() => setShowLogin(true)}
                className="w-full flex items-center justify-between bg-white text-black font-bold py-5 px-6 rounded-2xl active:scale-[0.97] transition-transform shadow-lg shadow-white/10"
              >
                <div className="flex items-center gap-3">
                  <Fingerprint className="w-5 h-5" />
                  <span>Sign In</span>
                </div>
                <ArrowRight className="w-5 h-5" />
              </button>

              <button
                onClick={onGuest}
                className="w-full flex items-center justify-between bg-white/5 border border-white/10 text-white font-bold py-5 px-6 rounded-2xl active:scale-[0.97] transition-transform backdrop-blur-md"
              >
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-slate-400" />
                  <span>Continue as Guest</span>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-400" />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="login-form"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="space-y-4"
            >
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Name</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-brand/50 transition-colors"
                  placeholder="Enter your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="relative">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Password</label>
                <input
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 pr-12 text-white focus:outline-none focus:border-brand/50 transition-colors"
                  placeholder="••••••••"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button onClick={() => setShowPass(!showPass)} className="absolute right-4 bottom-4 text-slate-500">
                  {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              <button
                onClick={() => onLogin(name || 'User')}
                className="w-full bg-brand text-white font-bold py-4 rounded-2xl active:scale-[0.97] transition-transform mt-2 shadow-lg shadow-brand/20"
              >
                Continue
              </button>

              <button
                onClick={() => setShowLogin(false)}
                className="w-full text-slate-500 text-sm font-medium py-2"
              >
                ← Back to options
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-[10px] text-slate-600 pb-8 px-8"
      >
        SenseNet v2.0 — Hackathon Build 2026
      </motion.p>
    </motion.div>
  );
}

// ========================================
// SCREEN 2: PERMISSIONS
// ========================================
function PermissionsScreen({ onContinue }: { onContinue: () => void }) {
  const [micOk, setMicOk] = useState(false);
  const [camOk, setCamOk] = useState(false);

  const requestMic = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      setMicOk(true);
    } catch { setMicOk(false); }
  };

  const requestCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach(t => t.stop());
      setCamOk(true);
    } catch { setCamOk(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex-1 flex flex-col justify-center px-8 relative z-10"
    >
      <h2 className="text-3xl font-bold text-white mb-2">Permissions</h2>
      <p className="text-sm text-slate-400 mb-8 leading-relaxed">SenseNet needs sensor access to protect you. Grant these to continue.</p>

      <div className="space-y-4 mb-8">
        <button onClick={requestMic} className={cn(
          "w-full flex items-center gap-4 p-5 rounded-2xl border transition-all active:scale-[0.98]",
          micOk ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/10"
        )}>
          <div className={cn("p-3 rounded-xl", micOk ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-slate-400")}>
            <Mic className="w-5 h-5" />
          </div>
          <div className="text-left flex-1">
            <p className="font-bold text-white text-sm">Microphone</p>
            <p className="text-xs text-slate-500">{micOk ? 'Access Granted ✓' : 'Required for sound detection'}</p>
          </div>
        </button>

        <button onClick={requestCam} className={cn(
          "w-full flex items-center gap-4 p-5 rounded-2xl border transition-all active:scale-[0.98]",
          camOk ? "bg-emerald-500/10 border-emerald-500/30" : "bg-white/5 border-white/10"
        )}>
          <div className={cn("p-3 rounded-xl", camOk ? "bg-emerald-500/20 text-emerald-400" : "bg-white/5 text-slate-400")}>
            <Camera className="w-5 h-5" />
          </div>
          <div className="text-left flex-1">
            <p className="font-bold text-white text-sm">Camera</p>
            <p className="text-xs text-slate-500">{camOk ? 'Access Granted ✓' : 'Required for visual context capture'}</p>
          </div>
        </button>
      </div>

      <div className="frosted rounded-xl p-4 mb-8">
        <p className="text-xs text-slate-400 leading-relaxed">
          <Wifi className="w-3.5 h-3.5 inline mr-1 text-brand" />
          Ensure your phone is connected to the <strong className="text-white">same WiFi network</strong> as the ESP32 wristband.
        </p>
      </div>

      <button
        onClick={onContinue}
        disabled={!micOk || !camOk}
        className={cn(
          "w-full py-4 rounded-2xl font-bold transition-all active:scale-[0.97]",
          micOk && camOk ? "bg-white text-black shadow-lg" : "bg-white/5 text-slate-600 cursor-not-allowed"
        )}
      >
        {micOk && camOk ? 'Continue' : 'Grant All Permissions'}
      </button>
    </motion.div>
  );
}

// ========================================
// SCREEN 3: DEVICE DISCOVERY
// ========================================
function DiscoveryScreen({ espIp, setEspIp, onContinue }: { espIp: string, setEspIp: (ip: string) => void, onContinue: () => void }) {
  const [scanning, setScanning] = useState(false);

  const fakeDeviceScan = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 2500);
  };

  useEffect(() => { fakeDeviceScan(); }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex-1 flex flex-col justify-center px-8 relative z-10"
    >
      <h2 className="text-3xl font-bold text-white mb-2">Find Wristband</h2>
      <p className="text-sm text-slate-400 mb-8 leading-relaxed">Scanning your local WiFi network for an ESP32 device...</p>

      <div className="frosted rounded-2xl p-6 mb-6 text-center relative overflow-hidden">
        {scanning ? (
          <div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              className="w-12 h-12 mx-auto mb-4 border-2 border-brand/30 border-t-brand rounded-full"
            />
            <p className="text-sm text-slate-400 font-medium">Scanning network...</p>
          </div>
        ) : (
          <div>
            <Wifi className="w-10 h-10 text-slate-500 mx-auto mb-4" />
            <p className="text-sm text-slate-400">{espIp ? `Device found at ${espIp}` : 'No devices auto-discovered'}</p>
          </div>
        )}
      </div>

      <div className="mb-8">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Manual IP Entry</label>
        <input
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white font-mono focus:outline-none focus:border-brand/50 transition-colors"
          placeholder="192.168.1.xxx"
          value={espIp}
          onChange={e => setEspIp(e.target.value)}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={onContinue}
          className="flex-1 py-4 rounded-2xl font-bold bg-white text-black active:scale-[0.97] transition-transform shadow-lg"
        >
          {espIp ? 'Connect & Continue' : 'Skip for Now'}
        </button>
      </div>
    </motion.div>
  );
}

// ========================================
// SCREEN 4: MAIN DASHBOARD
// ========================================
function DashboardScreen({ userName, espIp, threshold, setThreshold, vibrationDuration, setVibrationDuration, onOpenSettings, onAlert }: {
  userName: string;
  espIp: string;
  threshold: number;
  setThreshold: (t: number) => void;
  vibrationDuration: number;
  setVibrationDuration: (d: number) => void;
  onOpenSettings: () => void;
  onAlert: (data: AlertData) => void;
}) {
  const [systemState, setSystemState] = useState<StateLevel>('idle');
  const [logs, setLogs] = useState<LogItem[]>([]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasContext, setHasContext] = useState(false);

  const { startMonitoring, stopMonitoring, isMonitoring, level } = useAudioMonitor(threshold, () => {});

  const handleStart = () => { setSystemState('monitoring'); startMonitoring(); };
  const handleStop = () => { setSystemState('idle'); stopMonitoring(); };

  const pushLog = (label: string, score: number) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [{ id: Math.random().toString(), time, label, score }, ...prev].slice(0, 15));
  };

  const snapFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = ms;
      videoRef.current.play();
      setTimeout(() => {
        if (!videoRef.current || !canvasRef.current) return;
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.drawImage(videoRef.current, 0, 0);
        ms.getTracks().forEach(t => t.stop());
        setHasContext(true);
      }, 700);
    } catch (e) { console.error(e); }
  };

  const triggerEvent = async (label: string, score: number, category: AlertData['category']) => {
    if (systemState === 'alert') return;
    setSystemState('alert');
    pushLog(label, score);
    await snapFrame();
    if (espIp) fetch(`http://${espIp}/alert`, { mode: 'no-cors' }).catch(() => {});
    onAlert({ label, score, category });
  };

  const VIB_OPTIONS = [15, 30, 60, 120];

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      {/* Header */}
      <motion.header
        animate={{
          backgroundColor: systemState === 'alert' ? 'var(--color-danger)' : systemState === 'monitoring' ? 'var(--color-brand)' : 'var(--color-surface)',
        }}
        transition={{ duration: 0.5 }}
        className="shrink-0 px-6 py-4 flex items-center justify-between z-40 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <Hexagon className="w-5 h-5 text-white" fill="currentColor" />
          <span className="text-lg font-bold text-white">SenseNet</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-pill px-3 py-1.5 rounded-full flex items-center gap-2">
            <motion.div
              animate={{ scale: systemState === 'alert' ? [1, 1.3, 1] : 1 }}
              transition={{ repeat: systemState === 'alert' ? Infinity : 0, duration: 0.5 }}
              className={cn("w-2 h-2 rounded-full", systemState === 'monitoring' ? "bg-emerald-400" : systemState === 'alert' ? "bg-white" : "bg-slate-400")}
            />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest">{systemState}</span>
          </div>
          <button onClick={onOpenSettings} className="p-2 rounded-full bg-white/10 active:scale-90 transition-transform">
            <Settings2 className="w-4 h-4 text-white" />
          </button>
        </div>
      </motion.header>

      {/* Scrollable Dashboard */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-8">
        <p className="text-sm text-slate-400">Welcome back, <strong className="text-white">{userName}</strong></p>

        {/* BIG Monitoring Toggle */}
        <div className="frosted rounded-2xl p-6 flex flex-col items-center text-center">
          <button
            onClick={isMonitoring ? handleStop : handleStart}
            className={cn(
              "w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 active:scale-95 shadow-xl mb-4",
              isMonitoring
                ? "bg-danger text-white shadow-danger/30"
                : "bg-white text-black shadow-white/20"
            )}
          >
            {isMonitoring ? <Square className="w-10 h-10" fill="currentColor" /> : <Play className="w-10 h-10 ml-1" fill="currentColor" />}
          </button>
          <p className="font-bold text-white text-lg">{isMonitoring ? 'Monitoring Active' : 'Start Monitoring'}</p>
          <p className="text-xs text-slate-500 mt-1">{isMonitoring ? 'Tap to stop' : 'Tap to begin listening'}</p>
        </div>

        {/* Sound Meter */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Mic className="w-3.5 h-3.5" /> Sound Activity
            </h2>
            {isMonitoring && <span className="text-xs text-brand font-bold animate-pulse">LIVE</span>}
          </div>
          <div className="h-8 bg-black/40 rounded-xl overflow-hidden border border-white/5 p-1">
            <motion.div
              className="h-full bg-brand rounded-lg shadow-[0_0_15px_var(--color-brand)]"
              animate={{ width: `${level}%` }}
              transition={{ type: 'spring', bounce: 0, duration: 0.1 }}
            />
          </div>
        </section>

        {/* Threshold */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Alert Threshold</h2>
            <span className="text-brand font-mono font-bold text-sm">{threshold.toFixed(2)}</span>
          </div>
          <input
            type="range" min="0.5" max="0.95" step="0.01"
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            className="w-full accent-brand bg-white/10 h-2 rounded-full cursor-pointer appearance-none"
          />
        </section>

        {/* Vibration Duration (Auto-Stop Timer) */}
        <section className="frosted rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Timer className="w-3.5 h-3.5" /> Vibration Duration
            </h2>
            <span className="text-amber-400 font-mono font-bold text-sm">{vibrationDuration}s</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">Wristband vibrates for this long, then auto-stops.</p>
          <div className="grid grid-cols-4 gap-2">
            {VIB_OPTIONS.map(secs => (
              <button
                key={secs}
                onClick={() => setVibrationDuration(secs)}
                className={cn(
                  "py-3 rounded-xl font-bold text-sm transition-all active:scale-95",
                  vibrationDuration === secs
                    ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                    : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                )}
              >
                {secs}s
              </button>
            ))}
          </div>
        </section>

        {/* Camera Context */}
        <section className="frosted rounded-2xl p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-3">
            <Camera className="w-3.5 h-3.5" /> Visual Context
          </h2>
          <div className="aspect-[4/3] bg-black/50 rounded-xl border border-white/5 overflow-hidden flex items-center justify-center">
            <video ref={videoRef} className="hidden" playsInline muted />
            <canvas ref={canvasRef} className={cn("w-full h-full object-cover", !hasContext && "hidden")} />
            {!hasContext && <span className="text-xs text-slate-600 font-medium">Pending trigger...</span>}
          </div>
        </section>

        {/* Demo Simulate Buttons */}
        <section className="frosted rounded-2xl p-4 border border-dashed border-amber-500/30">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Demo Simulations
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => triggerEvent("Fire Alarm", 0.94, 'alarm')} className="py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-bold text-xs active:scale-95 transition-all">
              🔥 Fire Alarm
            </button>
            <button onClick={() => triggerEvent("Siren", 0.91, 'siren')} className="py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-bold text-xs active:scale-95 transition-all">
              🚨 Siren
            </button>
            <button onClick={() => triggerEvent("Door Knock", 0.87, 'knock')} className="py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-xs active:scale-95 transition-all">
              🚪 Knock
            </button>
            <button onClick={() => triggerEvent("Thunder", 0.82, 'thunder')} className="py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold text-xs active:scale-95 transition-all">
              ⛈️ Thunder
            </button>
          </div>
        </section>

        {/* Event Log */}
        <section className="frosted rounded-2xl p-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Event Log</h2>
          <div className="bg-black/30 rounded-xl overflow-hidden border border-white/5">
            <ul className="max-h-[180px] overflow-y-auto">
              {logs.length === 0 ? (
                <li className="p-4 text-center text-xs text-slate-600 italic">No events yet.</li>
              ) : logs.map((log, i) => (
                <li key={log.id} className={cn("px-4 py-3 flex items-center justify-between border-b border-white/5 last:border-0", i === 0 && "bg-white/5")}>
                  <div>
                    <p className="text-sm text-white font-medium">{log.label}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{log.time}</p>
                  </div>
                  <span className={cn("text-sm font-mono font-bold px-2 py-0.5 rounded-md", log.score >= threshold ? "bg-danger/20 text-danger-light" : "bg-white/10 text-white")}>
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

// ========================================
// SCREEN 5: SETTINGS (Slide-In Panel)
// ========================================
function SettingsPanel({ espIp, setEspIp, threshold, setThreshold, vibrationDuration, setVibrationDuration, onClose }: {
  espIp: string;
  setEspIp: (ip: string) => void;
  threshold: number;
  setThreshold: (t: number) => void;
  vibrationDuration: number;
  setVibrationDuration: (d: number) => void;
  onClose: () => void;
}) {
  const VIB_OPTIONS = [15, 30, 60, 120];

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
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="absolute top-0 right-0 bottom-0 w-[85%] bg-bg border-l border-white/10 z-50 flex flex-col"
      >
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button onClick={onClose} className="text-slate-400 text-sm font-bold active:scale-90 transition-transform">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">ESP32 Hardware</h3>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white font-mono focus:outline-none focus:border-brand/50 transition-colors"
              placeholder="192.168.1.xxx"
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">AI Threshold</h3>
              <span className="text-brand font-mono font-bold">{threshold.toFixed(2)}</span>
            </div>
            <input
              type="range" min="0.5" max="0.95" step="0.01"
              value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              className="w-full accent-brand bg-white/10 h-2 rounded-full cursor-pointer appearance-none"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Timer className="w-3.5 h-3.5" /> Auto-Stop Vibration
              </h3>
              <span className="text-amber-400 font-mono font-bold">{vibrationDuration}s</span>
            </div>
            <p className="text-xs text-slate-500 mb-3">Vibration will automatically stop after this duration.</p>
            <div className="grid grid-cols-4 gap-2">
              {VIB_OPTIONS.map(secs => (
                <button
                  key={secs}
                  onClick={() => setVibrationDuration(secs)}
                  className={cn(
                    "py-2.5 rounded-lg font-bold text-xs transition-all active:scale-95",
                    vibrationDuration === secs
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-slate-400 border border-white/10"
                  )}
                >
                  {secs}s
                </button>
              ))}
            </div>
          </div>
          <div className="frosted rounded-xl p-4 text-center">
            <ShieldCheck className="w-10 h-10 text-brand mx-auto mb-3" />
            <p className="text-xs text-slate-500">SenseNet v2.0 — Build 2026.03.14</p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ========================================
// SCREEN 6: FULL ALERT OVERLAY
// ========================================
function AlertScreen({ alertData, duration, onDismiss }: { alertData: AlertData, duration: number, onDismiss: () => void }) {
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

  const catInfo = SOUND_CATEGORIES[alertData.category] || SOUND_CATEGORIES.unknown;
  const CatIcon = catInfo.icon;
  const progressPercent = ((duration - secondsLeft) / duration) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex-1 flex flex-col relative overflow-hidden"
    >
      {/* Pulsing danger overlay */}
      <motion.div
        animate={{ opacity: [0.15, 0.3, 0.15] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="absolute inset-0 bg-danger pointer-events-none z-0"
      />

      {/* Top bar with close */}
      <div className="relative z-10 shrink-0 flex items-center justify-between px-6 py-4">
        <span className="text-xs font-bold text-white/70 uppercase tracking-widest animate-pulse">⚠ ALERT ACTIVE</span>
        <button onClick={onDismiss} className="p-2 bg-white/10 rounded-full active:scale-90 transition-transform">
          <X className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center relative z-10">
        
        {/* Pulsing Icon */}
        <motion.div
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ repeat: Infinity, duration: 1.2 }}
          className="w-28 h-28 bg-white rounded-full flex items-center justify-center mb-6 shadow-2xl shadow-white/20"
        >
          <CatIcon className="w-14 h-14 text-danger" />
        </motion.div>

        <h1 className="text-3xl font-bold text-white mb-1 tracking-tight">DANGER DETECTED</h1>
        
        {/* What was detected */}
        <div className="bg-white/10 backdrop-blur-md rounded-xl px-5 py-3 mt-4 mb-2 border border-white/20">
          <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1">Identified Sound</p>
          <p className="text-2xl font-bold text-white">{alertData.label}</p>
        </div>

        <p className={cn("text-sm font-bold mb-1", catInfo.color)}>
          Confidence: {alertData.score.toFixed(2)}
        </p>
        <p className="text-xs text-white/50 max-w-[280px] mb-6 leading-relaxed">
          {catInfo.description}
        </p>

        {/* Countdown with progress ring */}
        <div className="relative w-32 h-32 mb-6">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
            <motion.circle
              cx="60" cy="60" r="52" fill="none" stroke="white" strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={`${2 * Math.PI * 52 * (1 - progressPercent / 100)}`}
              transition={{ duration: 0.5 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-4xl font-mono font-bold text-white leading-none">{secondsLeft}</p>
            <p className="text-[9px] text-white/40 uppercase tracking-widest mt-1">seconds</p>
          </div>
        </div>

        <p className="text-xs text-white/40 mb-4">Wristband vibrating • Auto-stops in {secondsLeft}s</p>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="w-full max-w-[300px] py-5 rounded-2xl bg-white text-black font-bold text-lg active:scale-[0.97] transition-transform shadow-xl"
        >
          I'm Awake — Dismiss
        </button>
      </div>
    </motion.div>
  );
}
