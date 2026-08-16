import { useRef, useState, useCallback } from 'react';

/**
 * 语音录制 Hook —— 基于 MediaRecorder
 * - 录制时通过 Web Audio AnalyserNode 暴露实时振幅 levels（供波形动画）
 * - 可选通过 Web Speech API 做实时转写（transcript），不可用时静默跳过
 * - 支持开始/停止录音，停止后给出 Blob、时长与转写文本
 */

// 浏览器 SpeechRecognition 类型（标准未入 lib）
type SpeechRecognitionLike = any;

function getRecognitionCtor(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useVoice() {
  const [recording, setRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]); // 实时振幅 0~1
  const [transcript, setTranscript] = useState('');     // 实时转写文本

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const stopMeters = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    analyserRef.current = null;
    setLevels([]);
  }, []);

  const startMeters = useCallback((stream: MediaStream) => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // 取若干采样点计算均方根振幅
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // 平滑映射到 0~1（放大一点更好看）
        const level = Math.min(1, rms * 2.2);
        setLevels(prev => {
          const next = [...prev, level];
          return next.length > 28 ? next.slice(next.length - 28) : next;
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* 振幅可视化降级为关闭 */ }
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec: SpeechRecognitionLike = new Ctor();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
        }
        setTranscript(text);
      };
      rec.onerror = () => { /* 静默：转写不可用不影响录音 */ };
      rec.start();
      recognitionRef.current = rec;
    } catch { /* 忽略 */ }
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRecorderRef.current = mr;
      startTimeRef.current = Date.now();
      setRecording(true);
      setDurationMs(0);
      setTranscript('');
      timerRef.current = window.setInterval(() => {
        setDurationMs(Date.now() - startTimeRef.current);
      }, 100);
      startMeters(stream);
      startRecognition();
    } catch (e) {
      console.error('无法访问麦克风', e);
      alert('无法访问麦克风，请检查浏览器权限');
    }
  }, [recording, startMeters, startRecognition]);

  const stopRecording = useCallback((): Promise<{ blob: Blob; durationMs: number; transcript: string } | null> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr || mr.state === 'inactive') { resolve(null); return; }
      const finalTranscript = transcript;
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        const dur = Date.now() - startTimeRef.current;
        mr.stream.getTracks().forEach(t => t.stop());
        if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { /* ignore */ } recognitionRef.current = null; }
        stopMeters();
        setRecording(false);
        setDurationMs(0);
        setTranscript('');
        resolve({ blob, durationMs: dur, transcript: finalTranscript.trim() });
      };
      mr.stop();
    });
  }, [transcript, stopMeters]);

  const cancelRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.onstop = null;
      mr.stream.getTracks().forEach(t => t.stop());
      try { mr.stop(); } catch { /* ignore */ }
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { /* ignore */ } recognitionRef.current = null; }
    stopMeters();
    chunksRef.current = [];
    setRecording(false);
    setDurationMs(0);
    setTranscript('');
  }, [stopMeters]);

  return { recording, durationMs, levels, transcript, startRecording, stopRecording, cancelRecording };
}

/** Blob -> base64（去掉 data: 前缀） */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 根据 blob type 推断扩展名 */
export function blobExt(blob: Blob): string {
  const t = blob.type;
  if (t.includes('webm')) return 'webm';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('mp4') || t.includes('m4a')) return 'm4a';
  return 'webm';
}
