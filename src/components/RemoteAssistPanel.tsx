import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, Tabs, Button, Input, Tag, Switch } from 'tdesign-react';

interface RemoteAssistPanelProps {
  visible: boolean;
  agentName: string;
  onClose: () => void;
  /** 向 Agent 发送一条「本机远程协助」请求（以 bypass 权限执行） */
  onSendLocalAssist: (text: string) => void;
}

/**
 * 远程协助面板
 * - 本机协助：让 CodeBuddy Agent 以 bypass 权限在本机执行命令 / 操作文件（立即可用）。
 * - 远程桌面「双开自连」：在浏览器里打开两个 spark-chat 窗口，一方控制、一方被控，
 *   通过后端房间信令配对，建立真实 WebRTC 连接——屏幕经 PeerConnection 流式传输，
 *   鼠标/键盘经 RTCDataChannel 实时送达被控端并可见呈现。真正的跨机控制需在被控端运行原生协助进程。
 */
export function RemoteAssistPanel({ visible, agentName, onClose, onSendLocalAssist }: RemoteAssistPanelProps) {
  const [tab, setTab] = useState('local');
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (visible) {
      setLoggedIn(null);
      fetch('/api/check-login').then(r => r.json()).then((d: any) => setLoggedIn(!!d.isLoggedIn)).catch(() => setLoggedIn(null));
    }
  }, [visible]);

  return (
    <Dialog visible={visible} onClose={onClose} header="🛠 远程协助" width={760} footer={null}>
      <Tabs value={tab} onChange={v => setTab(v as string)}>
        <Tabs.TabPanel value="local" label="本机协助">
          <LocalAssist onSend={onSendLocalAssist} agentName={agentName} loggedIn={loggedIn} />
        </Tabs.TabPanel>
        <Tabs.TabPanel value="remote" label="远程桌面（双开自连）">
          <RemoteDesktop />
        </Tabs.TabPanel>
      </Tabs>
    </Dialog>
  );
}

function LocalAssist({ onSend, agentName, loggedIn }: { onSend: (t: string) => void; agentName: string; loggedIn: boolean | null }) {
  const presets = [
    { label: '🔍 诊断本机环境', text: '请帮我诊断当前电脑的环境：操作系统、Node/Python 版本、磁盘与内存占用，并给出优化建议。' },
    { label: '🧹 清理临时文件', text: '请帮我查找并清理常见的临时文件与缓存（仅列出并征得确认后再删），注意不要删除重要数据。' },
    { label: '📦 安装一个工具', text: '请帮我在本机安装一个常用开发工具，并验证安装成功。' },
    { label: '📝 整理工作目录', text: '请帮我整理当前工作目录：列出文件结构，把同类文件归类，并生成一个 README。' },
  ];
  return (
    <div className="space-y-3 py-1">
      <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
        你正在请求 <b>{agentName}</b> 以「跳过权限确认」的方式操作<b>本机</b>。它可以直接执行命令、读写文件、排查问题。
        请描述你希望它做什么：
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map(p => (
          <Button key={p.label} variant="outline" onClick={() => onSend(p.text)} style={{ justifyContent: 'flex-start' }}>
            {p.label}
          </Button>
        ))}
      </div>
      {loggedIn === false && (
        <div className="text-xs p-2 rounded-lg" style={{ backgroundColor: 'rgba(227,77,89,0.08)', color: '#e34d59' }}>
          ⚠️ 当前未配置 CodeBuddy 凭证，助手无法直接工作。请打开右上角「设置」填入 API Key / Auth Token，或终端执行 <code>codebuddy login</code>。
        </div>
      )}
      <div className="text-xs p-2 rounded-lg" style={{ backgroundColor: 'rgba(227,77,89,0.08)', color: '#e34d59' }}>
        ⚠️ 本机协助会真实修改你的电脑。Agent 默认先说明再操作，遇到危险动作仍可在聊天里点「拒绝」。
      </div>
    </div>
  );
}

type CtrlEvent =
  | { type: 'mouse'; x: number; y: number }
  | { type: 'mousedown' }
  | { type: 'mouseup' }
  | { type: 'drag'; x: number; y: number }
  | { type: 'wheel'; deltaY: number }
  | { type: 'key'; key: string };

const STATUS_THEME: Record<string, any> = { idle: 'default', connecting: 'warning', connected: 'success', error: 'danger' };
const STATUS_TEXT: Record<string, string> = { idle: '未连接', connecting: '连接中…', connected: '已连接', error: '连接失败' };

/**
 * 远程桌面「双开自连」：两个浏览器窗口经后端房间信令配对，建立真实 WebRTC 连接。
 * - 控制端：看到对方屏幕 + 在画面上操作（鼠标/拖拽/滚轮/键盘）。
 * - 被控端：共享自己的屏幕 + 实时呈现控制端的光标与键鼠。
 */
function RemoteDesktop() {
  const [mode, setMode] = useState<'choose' | 'controller' | 'controlled'>('choose');

  return (
    <div className="py-1">
      {mode === 'choose' && (
        <div className="space-y-3">
          <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
            在<b>两个浏览器窗口</b>里打开本应用，一方选「控制端」、另一方选「被控端」，用房间码配对即可建立真实远程桌面连接。
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('controller')}
              className="rounded-xl p-4 text-left border transition hover:shadow"
              style={{ borderColor: 'var(--td-component-stroke)', backgroundColor: 'var(--td-bg-color-container)' }}
            >
              <div className="text-base font-medium" style={{ color: 'var(--td-text-color-primary)' }}>🖥 我是控制端</div>
              <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>生成房间码，查看对方屏幕并远程操作（鼠标/键盘）。</div>
            </button>
            <button
              onClick={() => setMode('controlled')}
              className="rounded-xl p-4 text-left border transition hover:shadow"
              style={{ borderColor: 'var(--td-component-stroke)', backgroundColor: 'var(--td-bg-color-container)' }}
            >
              <div className="text-base font-medium" style={{ color: 'var(--td-text-color-primary)' }}>📡 我是被控端</div>
              <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-secondary)' }}>输入房间码，共享我的屏幕，接收对方控制。</div>
            </button>
          </div>
          <div className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
            提示：浏览器要求 https 或 localhost 才能共享屏幕，当前开发环境满足。真实跨机需在「被控端」运行原生协助进程注入键鼠。
          </div>
        </div>
      )}
      {mode === 'controller' && <ControllerPane onBack={() => setMode('choose')} />}
      {mode === 'controlled' && <ControlledPane onBack={() => setMode('choose')} />}
    </div>
  );
}

function ControllerPane({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const draggingRef = useRef(false);
  const roomRef = useRef<{ code: string; peerId: string; otherPeer: string }>({ code: '', peerId: '', otherPeer: '' });
  const lastIdRef = useRef(0);
  const pollRef = useRef<number | null>(null);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [roomCode, setRoomCode] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [remoteInput, setRemoteInput] = useState('');

  const addLog = (s: string) => setLog(prev => [...prev.slice(-8), `[${new Date().toLocaleTimeString()}] ${s}`]);
  const sendControl = (ev: CtrlEvent) => { if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify(ev)); };

  const stopAll = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null; dcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  };

  useEffect(() => () => stopAll(), []);

  const start = async () => {
    try {
      setStatus('connecting');
      const r = await fetch('/api/remote/room', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'controller' }),
      }).then(r => r.json());
      roomRef.current = { code: r.roomCode, peerId: r.peerId, otherPeer: '' };
      setRoomCode(r.roomCode);
      addLog('已创建房间 ' + r.roomCode + '，等待被控端加入…');

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      pc.onicecandidate = e => {
        if (e.candidate) sendSignal(roomRef.current.code, roomRef.current.peerId, roomRef.current.otherPeer || '', 'ice', e.candidate);
      };
      pc.ondatachannel = e => {
        dcRef.current = e.channel;
        dcRef.current.onopen = () => addLog('✅ 控制通道已打开');
        dcRef.current.onmessage = ev => {
          const d = JSON.parse(ev.data) as CtrlEvent;
          if (d.type === 'key') setRemoteInput(prev => (prev + d.key).slice(-40));
        };
      };
      // 收到被控端屏幕流 → 挂到 video 元素（#12 核心：控制端必须能看到远端桌面）
      pc.ontrack = e => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0];
          addLog('📺 已接收远端屏幕流');
        }
      };
      pc.onconnectionstatechange = () => {
        addLog('连接状态: ' + pc.connectionState);
        if (pc.connectionState === 'connected') setStatus('connected');
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('error');
      };

      // 轮询信令
      pollRef.current = window.setInterval(async () => {
        const data = await pollSignals(roomRef.current.code, roomRef.current.peerId, lastIdRef.current);
        for (const m of data.messages) {
          lastIdRef.current = Math.max(lastIdRef.current, m.id);
          if (m.type === 'offer') {
            await pc.setRemoteDescription(m.payload);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            roomRef.current.otherPeer = m.from;
            await sendSignal(roomRef.current.code, roomRef.current.peerId, m.from, 'answer', answer);
            addLog('收到 offer，已回 answer');
          } else if (m.type === 'ice') {
            try { await pc.addIceCandidate(m.payload); } catch {}
          }
        }
      }, 600);
    } catch (e: any) {
      addLog('启动失败: ' + e.message);
      setStatus('error');
    }
  };

  // 控制端捕获层：把归一化坐标发给被控端
  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    sendControl({ type: 'mouse', x, y });
    if (draggingRef.current) sendControl({ type: 'drag', x, y });
  };
  const onDown = () => { draggingRef.current = true; sendControl({ type: 'mousedown' }); };
  const onUp = () => { draggingRef.current = false; sendControl({ type: 'mouseup' }); };
  const onWheel = (e: React.WheelEvent) => sendControl({ type: 'wheel', deltaY: e.deltaY });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Tag theme={STATUS_THEME[status]}>{STATUS_TEXT[status]}</Tag>
        {status === 'idle' ? <Button theme="primary" onClick={start}>生成房间码</Button>
          : <Button theme="default" onClick={stopAll}>结束</Button>}
        <Button variant="text" onClick={onBack}>返回</Button>
      </div>

      {roomCode && (
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: 'var(--td-text-color-secondary)' }}>房间码：</span>
          <code className="px-2 py-1 rounded font-mono text-base" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }}>{roomCode}</code>
          <Button size="small" variant="outline" onClick={() => navigator.clipboard?.writeText(roomCode)}>复制</Button>
          <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>把此码发给被控端窗口</span>
        </div>
      )}

      <div>
        <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>对方的屏幕（在此区域操作即可远程控制）</div>
        <div
          className="relative rounded-lg overflow-hidden select-none"
          style={{ backgroundColor: '#000', aspectRatio: '16 / 10', cursor: status === 'connected' ? 'crosshair' : 'default' }}
          onMouseMove={status === 'connected' ? onMove : undefined}
          onMouseDown={status === 'connected' ? onDown : undefined}
          onMouseUp={status === 'connected' ? onUp : undefined}
          onMouseLeave={status === 'connected' ? onUp : undefined}
          onWheel={status === 'connected' ? onWheel : undefined}
        >
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
          {status !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">
              {status === 'idle' ? '点击「生成房间码」并等待被控端连接' : '等待被控端加入并共享屏幕…'}
            </div>
          )}
        </div>
        <input
          placeholder="在此输入 → 模拟远程键盘，被控端会显示"
          disabled={status !== 'connected'}
          onKeyDown={e => { e.stopPropagation(); sendControl({ type: 'key', key: e.key === 'Enter' ? '\n' : e.key }); }}
          className="w-full rounded-md px-2 py-1.5 text-sm outline-none border mt-1.5"
          style={{
            borderColor: 'var(--td-component-stroke)',
            backgroundColor: status === 'connected' ? 'var(--td-bg-color-container)' : 'var(--td-bg-color-component)',
            color: 'var(--td-text-color-primary)',
          }}
        />
      </div>

      <div className="text-[11px] font-mono rounded-lg p-2 max-h-24 overflow-y-auto" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

function ControlledPane({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<{ code: string; peerId: string; otherPeer: string }>({ code: '', peerId: '', otherPeer: '' });
  const lastIdRef = useRef(0);
  const pollRef = useRef<number | null>(null);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [codeInput, setCodeInput] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [win, setWin] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.45 });
  const [remoteInput, setRemoteInput] = useState('');
  const [useNative, setUseNative] = useState(false);
  const [helperConnected, setHelperConnected] = useState(false);
  const useNativeRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  const addLog = (s: string) => setLog(prev => [...prev.slice(-8), `[${new Date().toLocaleTimeString()}] ${s}`]);

  // 原生键鼠注入：连接被控机上的 assist-helper 进程（ws://127.0.0.1:17890）
  const connectHelper = () => {
    try {
      const ws = new WebSocket('ws://127.0.0.1:17890');
      wsRef.current = ws;
      ws.onopen = () => { setHelperConnected(true); addLog('✅ 已连接原生注入助手（真·OS 键鼠）'); };
      ws.onclose = () => { setHelperConnected(false); addLog('原生注入助手已断开'); };
      ws.onerror = () => { setHelperConnected(false); };
    } catch { setHelperConnected(false); }
  };
  const disconnectHelper = () => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null; setHelperConnected(false);
  };
  const onToggleNative = (v: boolean) => {
    setUseNative(v); useNativeRef.current = v;
    if (v) connectHelper(); else disconnectHelper();
  };

  // 原生助手进程管理（由后端 spawn 项目自带的 native-assistant/assist-helper.js）
  const [helperRunning, setHelperRunning] = useState(false);
  const [helperPid, setHelperPid] = useState<number | null>(null);
  const [helperError, setHelperError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const refreshHelper = useCallback(async () => {
    try {
      const d = await fetch('/api/native-assistant/status').then(r => r.json());
      setHelperRunning(!!d.running); setHelperPid(d.pid ?? null); setHelperError(d.error ?? null);
    } catch { /* ignore */ }
  }, []);
  const startHelper = useCallback(async () => {
    setStarting(true);
    try {
      const d = await fetch('/api/native-assistant/start', { method: 'POST' }).then(r => r.json());
      setHelperRunning(!!d.running); setHelperPid(d.pid ?? null); setHelperError(d.error ?? null);
      if (d.running) connectHelper();
    } finally { setStarting(false); }
  }, [connectHelper]);
  const stopHelper = useCallback(async () => {
    try {
      const d = await fetch('/api/native-assistant/stop', { method: 'POST' }).then(r => r.json());
      setHelperRunning(false); setHelperPid(null); setHelperError(d.error ?? null);
      disconnectHelper();
    } catch { /* ignore */ }
  }, [disconnectHelper]);

  useEffect(() => { refreshHelper(); }, [refreshHelper]);

  const stopAll = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    disconnectHelper();
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null; dcRef.current = null; streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle'); setCursor(null); setRemoteInput('');
  };

  useEffect(() => () => stopAll(), []);

  const connect = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    try {
      setStatus('connecting');
      const join = await fetch('/api/remote/room/' + code + '/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      }).then(r => r.json());
      if (join.error) { addLog('加入失败: ' + join.error); setStatus('error'); return; }
      roomRef.current = { code: join.roomCode, peerId: join.peerId, otherPeer: join.controllerPeerId };
      addLog('已加入房间 ' + join.roomCode + '（角色：被控端）');

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => { addLog('屏幕共享被停止'); stopAll(); });

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const dc = pc.createDataChannel('control');
      dcRef.current = dc;
      dc.onopen = () => addLog('✅ 控制通道已打开');
      dc.onmessage = ev => {
        const d = JSON.parse(ev.data) as CtrlEvent;
        // 始终在页内呈现光标/窗口，便于观察
        switch (d.type) {
          case 'mouse': setCursor({ x: d.x, y: d.y }); break;
          case 'mousedown': addLog('收到鼠标按下'); break;
          case 'mouseup': addLog('收到鼠标抬起'); break;
          case 'drag': setWin({ x: d.x, y: d.y }); break;
          case 'wheel': addLog('滚轮 Δ' + d.deltaY); break;
          case 'key': setRemoteInput(prev => (prev + d.key).slice(-40)); break;
        }
        // 启用原生注入且助手已连接 → 转发为真实 OS 键鼠输入
        if (useNativeRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify(d)); } catch {}
        }
      };

      pc.onicecandidate = e => {
        if (e.candidate) sendSignal(roomRef.current.code, roomRef.current.peerId, roomRef.current.otherPeer, 'ice', e.candidate);
      };
      pc.onconnectionstatechange = () => {
        addLog('连接状态: ' + pc.connectionState);
        if (pc.connectionState === 'connected') setStatus('connected');
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('error');
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(roomRef.current.code, roomRef.current.peerId, roomRef.current.otherPeer, 'offer', offer);
      addLog('已发送 offer，等待控制端回应…');

      pollRef.current = window.setInterval(async () => {
        const data = await pollSignals(roomRef.current.code, roomRef.current.peerId, lastIdRef.current);
        for (const m of data.messages) {
          lastIdRef.current = Math.max(lastIdRef.current, m.id);
          if (m.type === 'answer') { await pc.setRemoteDescription(m.payload); addLog('收到 answer'); }
          else if (m.type === 'ice') { try { await pc.addIceCandidate(m.payload); } catch {} }
        }
      }, 600);
    } catch (e: any) {
      addLog('连接失败: ' + e.message);
      setStatus('error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Tag theme={STATUS_THEME[status]}>{STATUS_TEXT[status]}</Tag>
        {status === 'idle' ? <Button theme="primary" onClick={connect}>连接并开始共享</Button>
          : <Button theme="default" onClick={stopAll}>结束</Button>}
        <Button variant="text" onClick={onBack}>返回</Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={codeInput}
          onChange={v => setCodeInput(v as string)}
          placeholder="输入控制端给的房间码"
          style={{ maxWidth: 200 }}
          disabled={status !== 'idle'}
        />
        <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>被控端会与房间里的控制端配对</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap rounded-lg px-3 py-2 border" style={{ backgroundColor: 'var(--td-bg-color-container)', borderColor: 'var(--td-component-stroke)' }}>
        <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>原生键鼠注入助手</span>
        <Tag theme={helperRunning ? 'success' : 'default'}>
          {helperRunning ? `运行中 (PID ${helperPid ?? '?'})` : '未运行'}
        </Tag>
        {helperRunning
          ? <Button size="small" variant="outline" theme="danger" onClick={stopHelper}>停止助手</Button>
          : <Button size="small" theme="primary" loading={starting} onClick={startHelper}>启动助手</Button>}
        <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          一键启动项目自带的 native-assistant 进程（监听 :17890）
        </span>
      </div>
      {helperError && (
        <div className="text-xs p-2 rounded-lg" style={{ backgroundColor: 'rgba(227,77,89,0.08)', color: '#e34d59' }}>
          ⚠️ {helperError}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
        <Switch size="small" value={useNative} disabled={!helperRunning} onChange={onToggleNative} />
        <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>启用原生键鼠注入（真·跨机控制）</span>
        <Tag theme={helperConnected ? 'success' : 'default'}>
          {helperConnected ? '助手已连接' : '助手未连接'}
        </Tag>
        <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
          {helperRunning ? '开关打开即把控制事件注入真实系统光标' : '请先「启动助手」再开启'}
        </span>
      </div>

      <div>
        <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>我共享的屏幕（光标/窗口会随控制端移动）</div>
        <div className="relative rounded-lg overflow-hidden" style={{ backgroundColor: '#000', aspectRatio: '16 / 10' }}>
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
          {cursor && (
            <div className="absolute pointer-events-none" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, transform: 'translate(-2px,-2px)' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#07c160', boxShadow: '0 0 6px #000' }} />
            </div>
          )}
          <div
            className="absolute pointer-events-none rounded-md flex items-center justify-center text-[10px] text-white"
            style={{ left: `${win.x * 100}%`, top: `${win.y * 100}%`, width: 80, height: 52, backgroundColor: 'rgba(0,82,217,0.85)' }}
          >
            被控窗口
          </div>
          {status !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
              {status === 'idle' ? '输入房间码并点击「连接」' : '等待与控制端建立连接…'}
            </div>
          )}
        </div>
        <div className="mt-1 text-[11px] font-mono rounded-md px-2 py-1 truncate" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}>
          控制端键入：{remoteInput || '（空）'}
        </div>
      </div>

      <div className="text-[11px] font-mono rounded-lg p-2 max-h-24 overflow-y-auto" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

// ---- 信令辅助 ----
async function sendSignal(code: string, from: string, to: string, type: string, payload: any) {
  try {
    await fetch('/api/remote/room/' + code + '/signal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, type, payload }),
    });
  } catch {}
}
async function pollSignals(code: string, peer: string, lastId: number) {
  try {
    const r = await fetch('/api/remote/room/' + code + '/signal?peer=' + encodeURIComponent(peer) + '&lastId=' + lastId);
    return await r.json();
  } catch { return { messages: [] }; }
}
