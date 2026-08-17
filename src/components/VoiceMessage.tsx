import { useRef, useState, useEffect, useMemo } from 'react';
import { Play, Pause } from 'lucide-react';

function fmt(ms?: number | null) {
  if (!ms || ms < 0) return '0:00';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 从音频解码提取真实波形峰值（每 bar 一个 0~1 高度）
async function decodeWaveform(url: string, bars = 36): Promise<number[]> {
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return [];
  const audioCtx: AudioContext = new Ctx();
  try {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(buf);
    const ch = audioBuf.getChannelData(0);
    const block = Math.floor(ch.length / bars) || 1;
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * block;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(ch[start + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const norm = Math.max(...peaks, 0.0001);
    return peaks.map(p => 0.12 + (p / norm) * 0.88);
  } catch {
    return [];
  } finally {
    try { audioCtx.close(); } catch { /* ignore */ }
  }
}

export function VoiceMessage({ audioPath, duration, transcript, onPlayed }: { audioPath: string; duration?: number | null; transcript?: string | null; onPlayed?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    decodeWaveform(`/api/voice/${audioPath}`)
      .then(b => { if (alive) { setBars(b); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [audioPath]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrent(a.currentTime * 1000);
    const onEnd = () => { setPlaying(false); setCurrent(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { void a.play(); setPlaying(true); onPlayed?.(); }
  };

  const total = duration || 0;
  const progress = total > 0 ? Math.min(1, current / total) : 0;
  const shown = playing ? current : total;
  const displayBars = useMemo(() => bars.length ? bars : Array.from({ length: 36 }, () => 0.18), [bars]);

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 min-w-[200px] max-w-[280px]">
      <div className="flex items-center gap-3">
        <audio ref={audioRef} src={`/api/voice/${audioPath}`} preload="metadata" />
        <button
          onClick={toggle}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: 'inherit' }}
          title={playing ? '暂停' : '播放'}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="flex-1 flex items-center gap-[3px] h-6">
          {displayBars.map((h, i) => {
            const active = (i / displayBars.length) <= progress;
            return (
              <span
                key={i}
                className="rounded-full transition-colors"
                style={{ width: 3, height: `${Math.round(h * 24)}px`, backgroundColor: 'currentColor', opacity: active ? 1 : 0.3 }}
              />
            );
          })}
        </div>
        <span className="text-xs flex-shrink-0 tabular-nums" style={{ opacity: 0.85 }}>{loading ? '…' : fmt(shown)}</span>
      </div>
      {transcript ? (
        <div className="text-xs leading-relaxed pt-0.5" style={{ opacity: 0.92, whiteSpace: 'pre-wrap' }}>{transcript}</div>
      ) : null}
    </div>
  );
}
