/**
 * 跨机远程协助 · 会话与 action 中继（服务端中转）
 * ----------------------------------------------------------
 * 被控端（A）在会话里「发起远程协助」→ 创建 session（按 conversationId 绑定）。
 * A 的浏览器标签页轮询待执行 action；控制端（B，通常是星火助手）通过 remote_action
 * 工具经本模块把指令中继到 A 机器执行，并取回结果。全程服务器中转，无需 TURN。
 *
 * 设计取舍：复用「HTTP 轮询」而非新增 WebSocket（与 WebRTC 信令同一套路），
 * 降低复杂度和风险；命令执行延迟约一个轮询周期（~1.2s），对远程排障完全可接受。
 */
import { v4 as uuidv4 } from 'uuid';

interface RemoteAction {
  id: string;
  action: string;
  params: any;
  createdAt: number;
  done: boolean;
}

interface PendingResult {
  resolve: (r: { ok: boolean; output?: string; error?: string }) => void;
  timer: any;
}

interface RemoteSession {
  sessionId: string;
  conversationId: string;
  createdAt: number;
  status: 'active' | 'closed';
  actions: RemoteAction[];
  pending: Map<string, PendingResult>;
  audit: RemoteAuditEntry[];
}

const sessions = new Map<string, RemoteSession>();
const byConversation = new Map<string, string>(); // conversationId -> sessionId

const ACTION_TIMEOUT_MS = 30_000;
const MAX_ACTIONS = 200;
const MAX_AUDIT = 500;

/** 审计条目：被控端事后可据此核查「控制端在我的机器上做了什么」 */
interface RemoteAuditEntry {
  ts: number;
  kind: 'start' | 'request' | 'result' | 'close';
  action?: string;
  summary?: string; // 指令摘要（run_command=命令；read_file/write_file=路径，write_file 附字节数）
  ok?: boolean;
  error?: string;
}

/** 生成审计用的指令摘要（避免把大文件内容塞进审计记录） */
function summarizeParams(action: string, params: any): string {
  if (action === 'run_command') return String(params?.command ?? '');
  if (action === 'read_file') return String(params?.path ?? '');
  if (action === 'write_file') {
    const len = typeof params?.content === 'string' ? params.content.length : 0;
    return `${params?.path ?? ''} (${len} 字节)`;
  }
  return JSON.stringify(params ?? '');
}

function pushAudit(session: RemoteSession, entry: RemoteAuditEntry): void {
  session.audit.push(entry);
  if (session.audit.length > MAX_AUDIT) {
    session.audit.splice(0, session.audit.length - MAX_AUDIT);
  }
}

/** 被控端发起：按会话创建（或复用）一个活跃 session */
export function createSession(conversationId: string): { sessionId: string } {
  const existing = byConversation.get(conversationId);
  if (existing) {
    const s = sessions.get(existing);
    if (s && s.status === 'active') return { sessionId: s.sessionId };
  }
  const sessionId = uuidv4();
  const session: RemoteSession = {
    sessionId, conversationId, createdAt: Date.now(), status: 'active',
    actions: [], pending: new Map(), audit: [],
  };
  sessions.set(sessionId, session);
  byConversation.set(conversationId, sessionId);
  pushAudit(session, { ts: Date.now(), kind: 'start', summary: `conversationId=${conversationId}` });
  return { sessionId };
}

/** 控制端 / 工具侧：取会话的活跃 sessionId（无则 null） */
export function getSessionIdByConversation(conversationId: string): string | null {
  const id = byConversation.get(conversationId);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s || s.status !== 'active') return null;
  return id;
}

/** 结束会话并拒绝所有挂起 action */
export function closeSession(conversationId: string): void {
  const id = byConversation.get(conversationId);
  if (!id) return;
  const s = sessions.get(id);
  if (s) {
    s.status = 'closed';
    pushAudit(s, { ts: Date.now(), kind: 'close' });
    for (const [, p] of s.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: '会话已关闭' });
    }
    s.pending.clear();
  }
  byConversation.delete(conversationId);
}

/**
 * 控制端调用：把一条 action 入队，等待被控端取走并执行后回传结果。
 * 超时（30s）未完成则视为被控端离线。
 */
export function enqueueAction(
  conversationId: string,
  action: string,
  params: any,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const sessionId = getSessionIdByConversation(conversationId);
  if (!sessionId) {
    return Promise.resolve({ ok: false, error: '该会话没有活跃的远程协助 session（请先在被控端发起远程协助）' });
  }
  const session = sessions.get(sessionId)!;
  const id = uuidv4();
  session.actions.push({ id, action, params, createdAt: Date.now(), done: false });
  if (session.actions.length > MAX_ACTIONS) {
    session.actions.splice(0, session.actions.length - MAX_ACTIONS);
  }
  pushAudit(session, { ts: Date.now(), kind: 'request', action, summary: summarizeParams(action, params) });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      resolve({ ok: false, error: '等待被控端执行超时（30s），请确认被控端已发起远程协助并保持在线' });
    }, ACTION_TIMEOUT_MS);
    session.pending.set(id, { resolve, timer });
  });
}

/** 被控端轮询：取回自己尚未处理过的 action（按 lastId 增量） */
export function fetchPendingActions(sessionId: string, lastId: string): RemoteAction[] {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'active') return [];
  const idx = session.actions.findIndex(a => a.id === lastId);
  const start = idx >= 0 ? idx + 1 : 0;
  return session.actions.slice(start).filter(a => !a.done);
}

/** 被控端回传执行结果 */
export function submitResult(
  sessionId: string,
  actionId: string,
  result: { ok: boolean; output?: string; error?: string },
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  const act = session.actions.find(a => a.id === actionId);
  if (!act || act.done) return false;
  act.done = true;
  const p = session.pending.get(actionId);
  if (p) {
    clearTimeout(p.timer);
    session.pending.delete(actionId);
    p.resolve(result);
  }
  pushAudit(session, {
    ts: Date.now(), kind: 'result', action: act.action,
    summary: summarizeParams(act.action, act.params),
    ok: result.ok, error: result.error,
  });
  return true;
}

/** 查询某 session 的审计记录（被控端事后核查用；未知 sessionId 返空数组） */
export function getAudit(sessionId: string): RemoteAuditEntry[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return session.audit.map((e) => ({ ...e }));
}
