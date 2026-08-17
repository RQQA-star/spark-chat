import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, Button, Tag } from 'tdesign-react';
import { isDangerous } from './remoteAssistSafety';

interface RemoteAssistSessionProps {
  visible: boolean;
  conversationId: string;
  onClose: () => void;
}

type RemoteActionType = 'run_command' | 'read_file' | 'write_file';
interface RemoteAction {
  id: string;
  action: RemoteActionType;
  params: Record<string, any>;
}

/** 服务端审计条目（与 server/remoteSession.ts 的 RemoteAuditEntry 对应） */
interface ServerAuditEntry {
  ts: number;
  kind: 'start' | 'request' | 'result' | 'close';
  action?: string;
  summary?: string;
  ok?: boolean;
  error?: string;
}

const HELPER_WS = 'ws://127.0.0.1:17890';

const AUDIT_KIND_LABEL: Record<string, string> = {
  start: '▶ 发起',
  request: '→ 请求',
  result: '← 结果',
  close: '■ 结束',
};

/**
 * 跨机远程协助 · 被控端桥接面板（含执行前确认闸）
 * ----------------------------------------------------------
 * 被控端（A）在此「发起远程协助」→ 后端建 session；本组件维护两条链路：
 *   1) 轮询 GET /api/remote/session/:id/actions 取控制端（B / 星火助手）下发的指令；
 *   2) 每条指令先弹窗经用户「允许 / 拒绝」确认——危险命令默认自动拒绝；
 *   3) 确认后才转发到本机原生助手（ws://127.0.0.1:17890）真实执行；
 *   4) 收到原生助手执行结果后 POST /api/remote/session/:id/result 回传控制端。
 * 全程服务器中转，无需 TURN；B 的 AI 只要在同源会话里即可远程操作 A 的电脑，
 * 但每一次动手都必须经过 A 本人授权，杜绝越权/误执行。
 */

function actionSummary(a: RemoteAction): { title: string; detail: string } {
  if (a.action === 'run_command') {
    return { title: '执行命令', detail: a.params?.command || '(空命令)' };
  }
  if (a.action === 'write_file') {
    const content: string = a.params?.content || '';
    const snippet = content.length > 200 ? content.slice(0, 200) + ' …（已截断）' : content;
    return { title: `写入文件（${content.length} 字节）`, detail: `路径：${a.params?.path || '(空)'}\n内容：${snippet}` };
  }
  if (a.action === 'read_file') {
    return { title: '读取文件', detail: a.params?.path || '(空路径)' };
  }
  return { title: a.action, detail: JSON.stringify(a.params) };
}

export function RemoteAssistSession({ visible, conversationId, onClose }: RemoteAssistSessionProps) {
  const [status, setStatus] = useState<'idle' | 'active' | 'closed' | 'error'>('idle');
  const [helperConnected, setHelperConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [autoDenyDanger, setAutoDenyDanger] = useState(true);
  const [audit, setAudit] = useState({ allowed: 0, denied: 0, failed: 0 });
  const [dialogAction, setDialogAction] = useState<RemoteAction | null>(null);
  const [serverAudit, setServerAudit] = useState<ServerAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<RemoteAction[]>([]);
  const currentRef = useRef<RemoteAction | null>(null);
  const lastIdRef = useRef<string>('');

  const addLog = (s: string) => setLog((prev) => [...prev.slice(-14), `[${new Date().toLocaleTimeString()}] ${s}`]);
  const bumpAudit = (k: 'allowed' | 'denied' | 'failed') => setAudit((p) => ({ ...p, [k]: p[k] + 1 }));

  const postResult = useCallback((actionId: string, ok: boolean, output?: string, error?: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch(`/api/remote/session/${sid}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, ok, output, error }),
    }).catch(() => {});
  }, []);

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
    seenRef.current = new Set();
    pendingRef.current = [];
    currentRef.current = null;
    lastIdRef.current = '';
    setDialogAction(null);
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
            if (!d.ok) bumpAudit('failed');
            addLog(`← ${d.ok ? '✅' : '❌'} ${String(d.actionId || '').slice(0, 6)}：${d.output || d.error || ''}`);
          }
        } catch { /* ignore */ }
      };
    } catch { setHelperConnected(false); }
  }, []);

  // 从待确认队列取一条弹出确认框（同一时刻只确认一条）
  const pumpQueue = useCallback(() => {
    if (currentRef.current) return;
    const next = pendingRef.current.shift();
    if (!next) return;
    currentRef.current = next;
    setDialogAction(next);
  }, []);

  // 用户允许：真正下发到原生助手执行
  const allowAction = useCallback(() => {
    const a = currentRef.current;
    if (!a) return;
    currentRef.current = null;
    setDialogAction(null);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'action', actionId: a.id, action: a.action, params: a.params }));
      addLog(`✅ 允许并下发 ${a.action}（${String(a.id).slice(0, 6)}）`);
      bumpAudit('allowed');
    } else {
      postResult(a.id, false, undefined, '本机原生助手未连接，无法执行');
      addLog(`⚠️ 本机原生助手未运行，已作废 ${a.action}（请先启动 native-assistant）`);
      bumpAudit('failed');
    }
    lastIdRef.current = a.id;
    setActionCount((c) => c + 1);
    pumpQueue();
  }, [postResult, pumpQueue]);

  // 用户拒绝：回传拒绝结果，绝不下发
  const denyAction = useCallback(() => {
    const a = currentRef.current;
    if (!a) return;
    currentRef.current = null;
    setDialogAction(null);
    postResult(a.id, false, undefined, '被控端已拒绝该操作');
    addLog(`⊘ 已拒绝 ${a.action}（${String(a.id).slice(0, 6)}）`);
    bumpAudit('denied');
    lastIdRef.current = a.id;
    setActionCount((c) => c + 1);
    pumpQueue();
  }, [postResult, pumpQueue]);

  // 自动拒绝危险命令（不弹窗）
  const autoDeny = useCallback((a: RemoteAction) => {
    postResult(a.id, false, undefined, '被控端自动拒绝危险操作');
    addLog(`🛡 自动拒绝危险操作 ${a.action}（${String(a.id).slice(0, 6)}）`);
    bumpAudit('denied');
    lastIdRef.current = a.id;
    setActionCount((c) => c + 1);
  }, [postResult]);

  const startPoll = useCallback(() => {
    pollRef.current = window.setInterval(async () => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const r = await fetch(`/api/remote/session/${sid}/actions?lastId=${encodeURIComponent(lastIdRef.current)}`);
        const data = await r.json();
        for (const a of data.actions || []) {
          if (seenRef.current.has(a.id)) continue;
          seenRef.current.add(a.id);
          // 危险命令：默认自动拒绝，不弹窗
          if (autoDenyDanger && isDangerous(a)) {
            autoDeny(a);
            continue;
          }
          pendingRef.current.push(a);
        }
        pumpQueue();
      } catch { /* ignore */ }
    }, 1200);
  }, [autoDenyDanger, autoDeny, pumpQueue]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/remote/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).then((r) => r.json());
      if (r.error) { addLog('发起失败：' + r.error); setStatus('error'); return; }
      sessionIdRef.current = r.sessionId;
      setStatus('active');
      addLog('已发起远程协助，每条指令执行前需你确认…');
      connectHelper();
      startPoll();
    } catch (e: any) {
      addLog('发起失败：' + (e?.message || e));
      setStatus('error');
    } finally { setBusy(false); }
  }, [conversationId, connectHelper, startPoll]);

  // 拉取服务端权威审计记录（被控端事后核查 / 与本地日志互补）
  const fetchAudit = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const r = await fetch(`/api/remote/session/${sid}/audit`);
      const data = await r.json();
      setServerAudit(Array.isArray(data.audit) ? data.audit : []);
    } catch { /* ignore */ }
  }, []);

  // 打开审计面板且协助进行中时，每 2s 自动刷新
  useEffect(() => {
    if (!auditOpen || status !== 'active') return;
    fetchAudit();
    const t = window.setInterval(fetchAudit, 2000);
    return () => window.clearInterval(t);
  }, [auditOpen, status, fetchAudit]);

  // 关闭面板时清理
  useEffect(() => {
    if (!visible) {
      stopAll();
      setStatus('idle'); setActionCount(0); setLog([]);
      setAudit({ allowed: 0, denied: 0, failed: 0 });
      setServerAudit([]); setAuditOpen(false);
    }
  }, [visible, stopAll]);
  useEffect(() => () => stopAll(), [stopAll]);

  const dialogDanger = dialogAction ? isDangerous(dialogAction) : false;
  const dialogInfo = dialogAction ? actionSummary(dialogAction) : null;

  return (
    <Dialog visible={visible} onClose={onClose} header="🛠 发起远程协助（跨机）" width={560} footer={null}>
      <div className="space-y-3 py-1">
        <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          发起后，本机将作为<b>被控端</b>。对方（或对方的星火助手）可在同一会话里远程操作你的电脑——
          例如「帮我把 AI 的 registry 设好」「改一下某个配置」。<b>每条指令执行前都会弹出确认框</b>，危险命令默认拒绝，服务器中转、无需额外穿透。
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

        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: 'var(--td-text-color-secondary)' }}>
          <input type="checkbox" checked={autoDenyDanger} onChange={(e) => setAutoDenyDanger(e.target.checked)} />
          自动拒绝危险命令（如 rm -rf / format / shutdown / 写系统目录，推荐保持开启）
        </label>

        {status === 'active' && (
          <div className="text-xs flex gap-3" style={{ color: 'var(--td-text-color-placeholder)' }}>
            <span>✅ 允许 {audit.allowed}</span>
            <span>⊘ 拒绝 {audit.denied}</span>
            <span>❌ 失败 {audit.failed}</span>
          </div>
        )}

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

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>完整审计（服务端权威记录）</span>
            <Button size="small" variant="text" disabled={status !== 'active'} onClick={() => setAuditOpen((o) => !o)}>
              {auditOpen ? '收起' : '📋 查看'}
            </Button>
          </div>
          {auditOpen && (
            <div className="text-[11px] font-mono rounded-lg p-2 max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
              {serverAudit.length ? serverAudit.slice().reverse().map((e, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="shrink-0 opacity-70">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="shrink-0">{AUDIT_KIND_LABEL[e.kind] || e.kind}</span>
                  <span className="break-all">
                    {[e.action, e.summary].filter(Boolean).join(' · ')}
                    {e.kind === 'result' ? (e.ok ? ' ✅' : ` ❌ ${e.error || ''}`) : ''}
                  </span>
                </div>
              )) : <div className="opacity-60">（暂无审计记录）</div>}
            </div>
          )}
        </div>
      </div>

      {/* 执行前确认闸 */}
      <Dialog
        visible={!!dialogAction}
        onClose={denyAction}
        header="⚠️ 即将执行远程指令，是否允许？"
        width={480}
        footer={null}
      >
        {dialogInfo && (
          <div className="space-y-3 py-1">
            <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
              对方（或对方的星火助手）请求在你的电脑上执行以下操作，<b>允许后才会真正动手</b>：
            </div>
            <div
              className="text-sm font-medium rounded-lg px-3 py-2"
              style={
                dialogDanger
                  ? { backgroundColor: 'rgba(227,77,89,0.1)', color: '#e34d59' }
                  : { backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }
              }
            >
              {dialogDanger && '🛡 检测到危险操作：'}{dialogInfo.title}
            </div>
            <pre
              className="text-[12px] font-mono rounded-lg p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }}
            >
              {dialogInfo.detail}
            </pre>
            <div className="flex justify-end gap-2">
              <Button theme="default" onClick={denyAction}>拒绝</Button>
              <Button
                theme={dialogDanger ? 'danger' : 'primary'}
                onClick={allowAction}
              >
                {dialogDanger ? '仍要执行' : '允许执行'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Dialog>
  );
}
