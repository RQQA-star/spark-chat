import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, Button, Tag } from 'tdesign-react';

interface RemoteAssistSessionProps {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
}

const HELPER_WS = 'ws://127.0.0.1:17890';

/**
 * 跨机远程协助 · 被控端桥接面板
 * ----------------------------------------------------------
 * 被控端（A）在此「发起远程协助」→ 后端建 session；本组件维护两条链路：
 *   1) 轮询 GET /api/remote/session/:id/actions 取控制端（B / 星火助手）下发的指令；
 *   2) 把指令转发到本机原生助手（ws://127.0.0.1:17890）真实执行；
 *   3) 收到原生助手执行结果后 POST /api/remote/session/:id/result 回传控制端。
 * 全程服务器中转，无需 TURN；B 的 AI 只要在同源会话里即可远程操作 A 的电脑。
 */
export function RemoteAssistSession({ visible, conversationId, onClose }: RemoteAssistSessionProps) {
  const [status, setStatus] = useState<'idle' | 'active' | 'closed' | 'error'>('idle');
  const [helperConnected, setHelperConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const sessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<number | null>(null);
  const sentRef = useRef<Set<string>>(new Set());
  const lastIdRef = useRef<string>('');

  const addLog = (s: string) => setLog(prev => [...prev.slice(-12), `[${new Date().toLocaleTimeString()}] ${s}`]);

  const stopAll = useCallback(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    setHelperConnected(false);
    if (sessionIdRef.current) {
      fetch('/api/remote/session/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});
    }
    sessionIdRef.current = null;
    sentRef.current = new Set();
    lastIdRef.current = '';
  }, [conversationId]);

  const connectHelper = useCallback(() => {
    try {
      const ws = new WebSocket(HELPER_WS);
      wsRef.current = ws;
      ws.onopen = () => { setHelperConnected(true); addLog('✅ 已连接本机原生助手（真实执行命令）'); };
      ws.onclose = () => { setHelperConnected(false); addLog('本机原生助手断开'); };
      ws.onerror = () => { setHelperConnected(false); };
      ws.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data as string);
          if (d.type === 'action_result') {
            const sid = sessionIdRef.current;
            if (sid) {
              fetch(`/api/remote/session/${sid}/result`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionId: d.actionId, ok: d.ok, output: d.output, error: d.error }),
              }).catch(() => {});
            }
            addLog(`← ${d.ok ? '✅' : '❌'} ${String(d.actionId || '').slice(0, 6)}：${d.output || d.error || ''}`);
          }
        } catch { /* ignore */ }
      };
    } catch { setHelperConnected(false); }
  }, []);

  const startPoll = useCallback(() => {
    pollRef.current = window.setInterval(async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const r = await fetch(`/api/remote/session/${sid}/actions?lastId=${encodeURIComponent(lastIdRef.current)}`);
        const data = await r.json();
        for (const a of data.actions || []) {
          if (sentRef.current.has(a.id)) continue;
          sentRef.current.add(a.id);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'action', actionId: a.id, action: a.action, params: a.params }));
            addLog(`→ 下发 ${a.action}（${String(a.id).slice(0, 6)}）`);
          } else {
            addLog(`⚠️ 本机原生助手未运行，无法执行 ${a.action}（请先启动 native-assistant）`);
          }
          lastIdRef.current = a.id;
          setActionCount(c => c + 1);
        }
      } catch { /* ignore */ }
    }, 1200);
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/remote/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).then(r => r.json());
      if (r.error) { addLog('发起失败：' + r.error); setStatus('error'); return; }
      sessionIdRef.current = r.sessionId;
      setStatus('active');
      addLog('已发起远程协助，等待控制端（对方 / 星火助手）指令…');
      connectHelper();
      startPoll();
    } catch (e: any) {
      addLog('发起失败：' + (e?.message || e));
      setStatus('error');
    } finally { setBusy(false); }
  }, [conversationId, connectHelper, startPoll]);

  // 关闭面板时清理
  useEffect(() => {
    if (!visible) { stopAll(); setStatus('idle'); setActionCount(0); setLog([]); }
  }, [visible, stopAll]);
  useEffect(() => () => stopAll(), [stopAll]);

  return (
    <Dialog visible={visible} onClose={onClose} header="🛠 发起远程协助（跨机）" width={560} footer={null}>
      <div className="space-y-3 py-1">
        <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          发起后，本机将作为<b>被控端</b>。对方（或对方的星火助手）可在同一会话里远程操作你的电脑——
          例如「帮我把 AI 的 registry 设好」「改一下某个配置」。指令经服务器中转，无需额外穿透。
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {status !== 'active' ? (
            <Button theme="primary" loading={busy} onClick={start}>发起远程协助</Button>
          ) : (
            <Button theme="default" onClick={stopAll}>结束协助</Button>
          )}
          <Tag theme={status === 'active' ? 'success' : 'default'}>
            {status === 'active' ? '协助中' : status === 'error' ? '失败' : '未发起'}
          </Tag>
          <Tag theme={helperConnected ? 'success' : 'default'}>
            {helperConnected ? '原生助手已连接' : '原生助手未连接'}
          </Tag>
          <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>已处理指令 {actionCount}</span>
        </div>

        {status === 'active' && !helperConnected && (
          <div className="text-xs p-2 rounded-lg" style={{ backgroundColor: 'rgba(227,77,89,0.08)', color: '#e34d59' }}>
            ⚠️ 本机原生助手未运行，指令将无法真实执行。请在被控机执行：<code>cd native-assistant &amp;&amp; npm install &amp;&amp; npm start</code>
          </div>
        )}

        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--td-text-color-secondary)' }}>执行日志</div>
          <div className="text-[11px] font-mono rounded-lg p-2 max-h-32 overflow-y-auto" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
            {log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div className="opacity-60">（暂无日志）</div>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
