import { useState, useRef } from 'react';

export function useAudioMonitor(threshold: number, onHighConfidence: (label: string, score: number) => void) {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const requestRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const smoothedRef = useRef(0);

  const startMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;          // More frequency bins → smoother reading
      analyser.smoothingTimeConstant = 0.8; // Built-in smoothing (0-1)
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      analyserRef.current = analyser;
      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      setIsMonitoring(true);
      setError(null);

      const updateLevel = () => {
        if (!analyserRef.current) return;

        // Use time-domain data (waveform) for accurate amplitude measurement
        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        analyser.getFloatTimeDomainData(dataArray);

        // Calculate true RMS of the waveform
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);

        // Convert RMS to decibels (dBFS)
        // Silence ≈ -∞ dB, max ≈ 0 dB
        const db = rms > 0.0001 ? 20 * Math.log10(rms) : -100;

        // Map dB range to 0-100%
        // -60 dB = silence/noise floor → 0%
        // -10 dB = very loud → 100%
        const noiseFloor = -60;
        const ceiling  = -10;
        const raw = ((db - noiseFloor) / (ceiling - noiseFloor)) * 100;
        const clamped = Math.max(0, Math.min(100, raw));

        // Exponential smoothing for natural feel
        // Fast attack (0.3), slow decay (0.92)
        const alpha = clamped > smoothedRef.current ? 0.3 : 0.08;
        smoothedRef.current = smoothedRef.current + alpha * (clamped - smoothedRef.current);

        setLevel(Math.round(smoothedRef.current));
        requestRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (err) {
      console.error(err);
      setError("Microphone access is required.");
    }
  };

  const stopMonitoring = () => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    smoothedRef.current = 0;
    setIsMonitoring(false);
    setLevel(0);
  };

  return { isMonitoring, level, error, startMonitoring, stopMonitoring };
}
