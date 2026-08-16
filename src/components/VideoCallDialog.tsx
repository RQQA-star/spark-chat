import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff } from 'lucide-react';

interface VideoCallDialogProps {
  visible: boolean;
  peerName: string;
  peerAvatarText?: string | null;
  peerAvatarColor?: string | null;
  isGroup?: boolean;
  onClose: () => void;
}

type CallState = 'connecting' | 'connected' | 'ended';

function Avatar({ text, color, size = 64 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#0052d9', fontSize: size * 0.4, borderRadius: size * 0.24 }}
    >
      {text || '?'}
    </div>
  );
}

export function VideoCallDialog({ visible, peerName, peerAvatarText, peerAvatarColor, isGroup, onClose }: VideoCallDialogProps) {
  const [state, setState] = useState<CallState>('connecting');
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  // 模拟"接通"：2 秒后进入 connected，并开始计时
  useEffect(() => {
    if (!visible) return;
    setState('connecting');
    setSeconds(0);
    const t = window.setTimeout(() => setState('connected'), 2000);
    return () => window.clearTimeout(t);
  }, [visible]);

  // 接通后计时
  useEffect(() => {
    if (state === 'connected') {
      timerRef.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
    }
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [state]);

  // 获取本地摄像头（失败则仅显示占位，不阻塞通话）
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch {
        // 无摄像头 / 拒绝授权：静默降级为头像占位
        streamRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [visible]);

  // 静音 / 关摄像头：实时切换轨道
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    s.getAudioTracks().forEach(t => (t.enabled = !muted));
    s.getVideoTracks().forEach(t => (t.enabled = !camOff));
  }, [muted, camOff]);

  const hangUp = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setState('ended');
    window.setTimeout(() => onClose(), 600);
  }, [onClose]);

  if (!visible) return null;

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        backgroundColor: state === 'ended' ? 'rgba(0,0,0,0.85)' : 'rgba(15,18,22,0.96)',
        color: '#fff',
        transition: 'background-color 0.4s',
      }}
    >
      {/* 远端画面（演示：用对方头像占位，无真实远端） */}
      <div className="relative w-[min(720px,92vw)] aspect-video rounded-2xl overflow-hidden flex items-center justify-center" style={{ backgroundColor: '#1f2630' }}>
        {state !== 'connecting' ? (
          <div className="flex flex-col items-center gap-3 opacity-90">
            <Avatar text={peerAvatarText} color={peerAvatarColor} size={96} />
            <div className="text-lg font-medium">{peerName}{isGroup ? '（群）' : ''}</div>
            {state === 'ended' && <div className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>通话已结束</div>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Avatar text={peerAvatarText} color={peerAvatarColor} size={96} />
            <div className="text-base" style={{ color: 'rgba(255,255,255,0.85)' }}>正在等待对方接受邀请…</div>
          </div>
        )}

        {/* 本地自视图（摄像头或占位） */}
        <div className="absolute right-4 bottom-4 w-40 h-28 rounded-xl overflow-hidden border-2" style={{ borderColor: 'rgba(255,255,255,0.25)', backgroundColor: '#000' }}>
          {camOff || !streamRef.current ? (
            <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: '#2a2f37' }}>
              <VideoOff size={22} style={{ color: 'rgba(255,255,255,0.5)' }} />
            </div>
          ) : (
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          )}
        </div>
      </div>

      {/* 状态文字 */}
      <div className="mt-5 text-center">
        <div className="text-base">{peerName}</div>
        <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
          {state === 'connecting' ? '连接中…' : state === 'ended' ? '通话结束' : `${mm}:${ss}`}
        </div>
        <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>本地模拟通话（演示）</div>
      </div>

      {/* 控制栏 */}
      <div className="mt-6 flex items-center gap-4">
        <ControlButton onClick={() => setMuted(m => !m)} active={muted} title={muted ? '取消静音' : '静音'}>
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </ControlButton>
        <ControlButton onClick={() => setCamOff(c => !c)} active={camOff} title={camOff ? '开启摄像头' : '关闭摄像头'}>
          {camOff ? <VideoOff size={22} /> : <VideoIcon size={22} />}
        </ControlButton>
        <button
          onClick={hangUp}
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ backgroundColor: '#fa5151', color: '#fff' }}
          title="挂断"
        >
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}

function ControlButton({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active: boolean; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-12 h-12 rounded-full flex items-center justify-center"
      style={{ backgroundColor: active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)', color: active ? '#e34d59' : '#fff' }}
    >
      {children}
    </button>
  );
}
