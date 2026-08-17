import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { query, unstable_v2_createSession, unstable_v2_authenticate, type PermissionResult, type CanUseTool } from "@tencent-ai/agent-sdk";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import * as db from "./db.js";
import * as nativeAssistant from "./nativeAssistant.js";
import { buildRemoteAssistMcpServer, buildRemoteActionMcpServer } from "./remoteAssistTools.js";
import { createSession, getSessionIdByConversation, closeSession, fetchPendingActions, submitResult, getAudit } from "./remoteSession.js";
import { isAllowedOrigin, isTokenValid, extractBearerToken, getAccessToken } from "./security.js";
import { securityHeaders, rateLimit } from "./hardening.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT: number = Number(process.env.PORT) || 3000;
// 供测试（supertest）挂载；生产/开发启动由下方 app.listen 负责
export { app };

// 优雅停机所需的活跃句柄（由 startServer 赋值）。
let activeServer: http.Server | null = null;
let activeWss: WebSocketServer | null = null;

// 优雅停机：关闭 WS 客户端、HTTP 服务、SQLite，并清理后台定时器。
// 在收到 SIGINT/SIGTERM（或测试显式调用）时执行，确保连接与文件句柄被释放。
export function shutdownServer(): void {
  try { clearInterval(roomSweepTimer); } catch { /* ignore */ }
  if (activeWss) {
    for (const c of activeWss.clients) { try { c.close(1001, 'server shutdown'); } catch { /* ignore */ } }
    try { activeWss.close(); } catch { /* ignore */ }
  }
  if (activeServer) {
    try { activeServer.close(); } catch { /* ignore */ }
    try {
      (activeServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    } catch { /* ignore */ }
  }
  try { db.closeDb(); } catch { /* ignore */ }
}

app.use(express.json({ limit: '25mb' }));

// ============= 生产健壮性加固（#85，零依赖等价于 helmet 子集） =============
// 安全响应头（覆盖所有响应，含静态资源与 SPA 回退）。
app.use(securityHeaders);
// 基础限流（按 IP 内存窗口，跳过 /api/health 存活探针）。
app.use('/api', rateLimit());

// ============= 本地安全加固：鉴权令牌 + Origin 校验（G3 + S3） =============
// 仅作用于 /api 路由（WebSocket 另有 verifyClient 把关，前端静态资源不在此列）。
// 细节口径见 server/security.ts：来源须为本机；配置了 SPARK_ACCESS_TOKEN 时强制 Bearer 校验。
// /api/health 为存活探针，永不鉴权。
app.use('/api', (req, res, next) => {
  // 挂载在 /api 下时 req.path 已被剥离前缀，故健康检查在此为 /health（始终免鉴权）
  if (req.path === '/health') return next();
  // 鉴权配置探测端点同样免鉴权：否则前端在未持有令牌时无法得知是否需要令牌（死锁）
  if (req.path === '/auth/config') return next();
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Origin 不被允许（仅允许本机 127.0.0.1 / localhost）' });
  }
  const provided = extractBearerToken(req.headers.authorization);
  if (!isTokenValid(provided)) {
    return res.status(401).json({ error: '未授权：缺少或错误的访问令牌' });
  }
  next();
});

// ============= WebSocket 实时同步中枢 =============
// 按会话维护订阅的客户端连接，用于多端（多标签页）之间的消息 / 已读 / 输入中 同步。
// 仅在非测试环境（app.listen 时）真正创建 WS server；测试用 supertest 直接挂载 app，不触达此处。
const wsSubs = new Map<string, Set<WebSocket>>();
function wsBroadcast(conversationId: string, payload: unknown, exclude?: WebSocket): void {
  const set = wsSubs.get(conversationId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch { /* 忽略个别连接发送失败 */ }
    }
  }
}

// 缓存可用模型列表
let cachedModels: Array<{ modelId: string; name: string; description?: string }> = [];
const defaultModel = "claude-sonnet-4";

// 固定 AI 助手联系人
const AGENT_CONTACT_ID = "agent_xinghuo";

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
  timestamp: number;
}
const pendingPermissions = new Map<string, PendingPermission>();
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---- 鉴权配置探测（免鉴权）----
// 前端启动时调用，得知服务端是否要求访问令牌（配置了 SPARK_ACCESS_TOKEN 则为 true）。
// 该端点自身免鉴权（见上方 /api 中间件跳过 /auth/config），以避免「未持令牌 → 无法探测 → 死锁」。
// 前端据此决定是否弹出「输入访问令牌」界面；未配置令牌时前端完全无感（保持本机免鉴权体验）。
app.get("/api/auth/config", (req, res) => {
  res.json({ tokenRequired: getAccessToken() !== '' });
});

// ---- 登录状态 ----
type LoginMethod = 'env' | 'cli' | 'none';
interface LoginStatusResponse {
  isLoggedIn: boolean; method?: LoginMethod; envConfigured?: boolean; cliConfigured?: boolean;
  error?: string; apiKey?: string;
  envVars?: { apiKey?: string; authToken?: string; internetEnv?: string; baseUrl?: string; };
}
app.get("/api/check-login", async (req, res) => {
  const response: LoginStatusResponse = { isLoggedIn: false, envConfigured: false, cliConfigured: false, envVars: {} };
  const apiKey = process.env.CODEBUDDY_API_KEY;
  const authToken = process.env.CODEBUDDY_AUTH_TOKEN;
  const internetEnv = process.env.CODEBUDDY_INTERNET_ENVIRONMENT;
  const baseUrl = process.env.CODEBUDDY_BASE_URL;
  if (apiKey || authToken) {
    response.envConfigured = true;
    if (apiKey) { response.envVars!.apiKey = apiKey.slice(0, 8) + '****' + apiKey.slice(-4); response.apiKey = response.envVars!.apiKey; }
    if (authToken) { response.envVars!.authToken = authToken.slice(0, 8) + '****' + authToken.slice(-4); }
    if (internetEnv) response.envVars!.internetEnv = internetEnv;
    if (baseUrl) response.envVars!.baseUrl = baseUrl;
  }
  try {
    let needsLogin = false;
    const result = await unstable_v2_authenticate({
      environment: 'external',
      onAuthUrl: async () => { needsLogin = true; response.error = '未登录，请先登录 CodeBuddy CLI'; }
    });
    if (!needsLogin && result?.userinfo) {
      response.isLoggedIn = true; response.cliConfigured = true;
      response.method = response.envConfigured ? 'env' : 'cli';
    } else if (!needsLogin) {
      response.isLoggedIn = true; response.cliConfigured = true;
      response.method = response.envConfigured ? 'env' : 'cli';
    }
  } catch (error: any) {
    if (response.envConfigured) { response.isLoggedIn = true; response.method = 'env'; }
    else { response.error = error?.message || String(error); response.method = 'none'; }
  }
  res.json(response);
});

app.post("/api/save-env-config", (req, res) => {
  const { apiKey, authToken, internetEnv, baseUrl } = req.body;
  if (!apiKey && !authToken) return res.status(400).json({ error: '请至少配置 API Key 或 Auth Token' });
  const configured: string[] = [];
  if (apiKey) { process.env.CODEBUDDY_API_KEY = apiKey; configured.push('CODEBUDDY_API_KEY'); }
  if (authToken) { process.env.CODEBUDDY_AUTH_TOKEN = authToken; configured.push('CODEBUDDY_AUTH_TOKEN'); }
  if (internetEnv) { process.env.CODEBUDDY_INTERNET_ENVIRONMENT = internetEnv; configured.push('CODEBUDDY_INTERNET_ENVIRONMENT'); }
  if (baseUrl) { process.env.CODEBUDDY_BASE_URL = baseUrl; configured.push('CODEBUDDY_BASE_URL'); }
  cachedModels = [];
  res.json({ success: true, message: `已设置: ${configured.join(', ')}`, note: '环境变量仅在当前服务器进程有效，重启后需要重新设置' });
});

// ---- 模型 ----
app.get("/api/models", async (req, res) => {
  try {
    if (cachedModels.length === 0) {
      try {
        const session = await unstable_v2_createSession({ cwd: process.cwd() });
        const models = await session.getAvailableModels();
        if (models && Array.isArray(models)) cachedModels = models;
      } catch (e) { /* 忽略，使用默认 */ }
    }
    res.json({
      models: cachedModels.length > 0 ? cachedModels : [{ modelId: "claude-sonnet-4", name: "Claude Sonnet 4" }],
      defaultModel,
    });
  } catch (error: any) {
    res.json({ models: [{ modelId: "claude-sonnet-4", name: "Claude Sonnet 4" }], defaultModel, error: error?.message || String(error) });
  }
});

// ============= 联系人 =============
app.get("/api/contacts", (req, res) => {
  try {
    const contacts = db.getAllContacts().map(c => ({
      id: c.id, name: c.name, avatarText: c.avatar_text, avatarColor: c.avatar_color,
      isAgent: !!c.is_agent, status: c.status,
      remark: c.remark || null,
      starred: !!c.starred,
      agentConfig: c.agent_config ? JSON.parse(c.agent_config) : null,
    }));
    res.json({ contacts, me: { id: db.ME_ID, name: '我' } });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取联系人失败' });
  }
});

// 新增联系人
app.post("/api/contacts", (req, res) => {
  try {
    const { name, avatarText, avatarColor } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '请输入联系人名称' });
    }
    const contact = db.createContact({ name: name.trim(), avatarText, avatarColor });
    res.json({
      contact: {
        id: contact.id, name: contact.name, avatarText: contact.avatar_text,
        avatarColor: contact.avatar_color, isAgent: false, status: contact.status, agentConfig: null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '添加联系人失败' });
  }
});

// 删除联系人
app.delete("/api/contacts/:id", (req, res) => {
  try {
    const ok = db.deleteContact(req.params.id);
    if (!ok) return res.status(400).json({ error: '无法删除该联系人（内置助手或本人不可删除）' });
    res.json({ success: ok });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '删除联系人失败' });
  }
});

// 更新联系人（名称/头像/AI 配置）
app.patch("/api/contacts/:id", (req, res) => {
  try {
    const { name, avatarText, avatarColor, agentConfig, remark, starred } = req.body || {};
    const updates: { name?: string; avatarText?: string; avatarColor?: string; agentConfig?: unknown; remark?: string; starred?: boolean } = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: '联系人名称不能为空' });
      updates.name = name.trim();
    }
    if (avatarText !== undefined) updates.avatarText = String(avatarText);
    if (avatarColor !== undefined) updates.avatarColor = String(avatarColor);
    if (agentConfig !== undefined) {
      // agentConfig 形如 { systemPrompt, permissionMode, model, cwd }，做基本结构校验
      if (typeof agentConfig !== 'object' || agentConfig === null) {
        return res.status(400).json({ error: 'agentConfig 格式错误' });
      }
      updates.agentConfig = agentConfig;
    }
    if (remark !== undefined) {
      if (remark !== null && (typeof remark !== 'string' || remark.length > 200)) {
        return res.status(400).json({ error: '备注过长（上限 200 字）' });
      }
      updates.remark = remark || null;
    }
    if (starred !== undefined) {
      if (typeof starred !== 'boolean') return res.status(400).json({ error: 'starred 必须为布尔值' });
      updates.starred = starred;
    }
    const updated = db.updateContact(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: '联系人不存在' });
    res.json({
      contact: {
        id: updated.id, name: updated.name, avatarText: updated.avatar_text,
        avatarColor: updated.avatar_color, isAgent: !!updated.is_agent, status: updated.status,
        remark: updated.remark || null, starred: !!updated.starred,
        agentConfig: updated.agent_config ? JSON.parse(updated.agent_config) : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '更新联系人失败' });
  }
});

// ============= 会话 =============
app.get("/api/conversations", (req, res) => {
  try {
    const conversations = db.getAllConversationsSerialized();
    res.json({ conversations });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取会话失败' });
  }
});

// ============= 群二维码（邀请入群） =============
// 返回含群 ID 的二维码：扫码内容形如 sparkchat://group/join?groupId=<id>
// 前端可在群管理面板展示 / 下载 PNG。纯本地邀请（无外部注册），扫码后由客户端提示"复制群号"。
app.get("/api/conversations/:id/qr", async (req, res) => {
  try {
    const conv = db.getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: '会话不存在' });
    if (conv.type !== 'group') return res.status(400).json({ error: '只有群聊可生成邀请二维码' });
    const payload = `sparkchat://group/join?groupId=${encodeURIComponent(conv.id)}`;
    const png = await QRCode.toDataURL(payload, { margin: 2, width: 320 });
    res.json({ groupId: conv.id, payload, qrDataUrl: png, title: conv.title });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '生成二维码失败' });
  }
});

app.post("/api/conversations", (req, res) => {
  try {
    const { type, participantIds = [], title, avatarText, avatarColor, isRemoteAssist } = req.body;
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: '请至少选择一个参与者' });
    }
    if (type === 'direct') {
      // 单聊去重
      const target = participantIds[0];
      const existing = db.findDirectConversation(target);
      if (existing) {
        return res.json({ conversation: db.serializeConversation(existing), existed: true });
      }
    }
    const conv = db.createConversation({
      type, participantIds, title, avatarText, avatarColor, isRemoteAssist: !!isRemoteAssist,
    });
    res.json({ conversation: db.serializeConversation(conv), existed: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '创建会话失败' });
  }
});

app.delete("/api/conversations/:id", (req, res) => {
  try {
    const ok = db.deleteConversation(req.params.id);
    res.json({ success: ok });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '删除会话失败' });
  }
});

// 更新会话（群名称 / 头像等）
app.patch("/api/conversations/:id", (req, res) => {
  try {
    const updates: { title?: string; avatarText?: string; avatarColor?: string; pinned?: boolean; muted?: boolean; announcement?: string } = {};
    if (typeof req.body.title === 'string') updates.title = req.body.title;
    if (typeof req.body.avatarText === 'string') updates.avatarText = req.body.avatarText;
    if (typeof req.body.avatarColor === 'string') updates.avatarColor = req.body.avatarColor;
    if (typeof req.body.pinned === 'boolean') updates.pinned = req.body.pinned;
    if (typeof req.body.muted === 'boolean') updates.muted = req.body.muted;
    if (typeof req.body.announcement === 'string') {
      if (req.body.announcement.length > 1000) return res.status(400).json({ error: '群公告过长（上限 1000 字）' });
      updates.announcement = req.body.announcement;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }
    const ok = db.updateConversation(req.params.id, updates);
    const conv = db.getConversation(req.params.id);
    if (conv) wsBroadcast(req.params.id, { type: 'conversation:update', conversation: db.serializeConversation(conv) });
    res.json({
      success: ok,
      conversation: conv ? db.serializeConversation(conv) : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '更新会话失败' });
  }
});

// ============= 消息 =============
app.get("/api/conversations/:id/messages", (req, res) => {
  try {
    db.markConversationRead(req.params.id);
    const limit = Math.min(parseInt(String(req.query.limit || '30'), 10) || 30, 100);
    const beforeCreatedAt = req.query.beforeCreatedAt ? String(req.query.beforeCreatedAt) : null;
    const beforeId = req.query.beforeId ? String(req.query.beforeId) : null;
    const before = (beforeCreatedAt && beforeId) ? { createdAt: beforeCreatedAt, id: beforeId } : null;
    const page = db.getMessagesPage(req.params.id, before, limit);
    res.json({ messages: page.messages, hasMore: page.hasMore, oldest: page.oldest });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取消息失败' });
  }
});

// 发送通用消息（文本 / 自动回复占位等）。Agent 消息走 /agent 端点。
// 客户端仅允许发送 text/voice/image/file/merged 及扩展类型（sticker/link/video/location/card）；
// agent/system 由服务端内部写入，禁止客户端伪造。
const CLIENT_MSG_TYPES = new Set(['text', 'voice', 'image', 'file', 'merged', 'sticker', 'link', 'video', 'location', 'card']);
const SERVER_MSG_TYPES = new Set(['agent', 'system']);
app.post("/api/conversations/:id/messages", (req, res) => {
  try {
    const conversationId = req.params.id;
    const conv = db.getConversation(conversationId);
    if (!conv) return res.status(404).json({ error: '会话不存在' });

    const { senderId, msgType = 'text', content, audioPath, imagePath, videoPath, duration, meta, transcript, fileName, fileSize, fileMime, filePath } = req.body;
    if (!senderId) return res.status(400).json({ error: '缺少 senderId' });
    // 禁止以助手身份发言（助手消息只能由 /agent 端点内部生成）
    if (senderId === AGENT_CONTACT_ID) {
      return res.status(403).json({ error: '不能以助手身份发言' });
    }
    if (typeof msgType !== 'string' || !CLIENT_MSG_TYPES.has(msgType)) {
      return res.status(400).json({ error: '不支持的消息类型（agent/system 仅限服务端）' });
    }
    // 按消息类型做必要字段校验
    if (msgType === 'text' && (!content || typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }
    if (msgType === 'image' && !imagePath) {
      return res.status(400).json({ error: '缺少 imagePath' });
    }
    if (msgType === 'voice' && !audioPath) {
      return res.status(400).json({ error: '缺少 audioPath' });
    }
    if (msgType === 'file' && !fileName) {
      return res.status(400).json({ error: '缺少 fileName' });
    }
    if (msgType === 'file' && !filePath) {
      return res.status(400).json({ error: '缺少 filePath（文件未上传）' });
    }
    if (msgType === 'sticker' && (!content || typeof content !== 'string' || !content.trim())) {
      return res.status(400).json({ error: '缺少表情内容' });
    }
    if (msgType === 'link' && (!content || typeof content !== 'string' || !/^https?:\/\//i.test(content))) {
      return res.status(400).json({ error: '缺少合法的链接地址（须以 http(s):// 开头）' });
    }
    if (msgType === 'video' && !videoPath) {
      return res.status(400).json({ error: '缺少 videoPath（视频未上传）' });
    }
    if (msgType === 'location' && (!meta || !meta.location || typeof meta.location.lat !== 'number' || typeof meta.location.lng !== 'number')) {
      return res.status(400).json({ error: '缺少位置坐标（meta.location.lat/lng）' });
    }
    if (msgType === 'card' && (!meta || !meta.card || typeof meta.card.cardId !== 'string' || !meta.card.cardId)) {
      return res.status(400).json({ error: '缺少名片联系人（meta.card.cardId）' });
    }
    if (meta !== undefined && (meta === null || typeof meta !== 'object' || Array.isArray(meta))) {
      return res.status(400).json({ error: 'meta 必须为对象' });
    }
    const clientId = typeof req.body.clientId === 'string' ? req.body.clientId : undefined;
    // msgType 已通过 CLIENT_MSG_TYPES 校验，断言为客户端允许的字面量联合类型以通过严格类型检查
    const safeMsgType = msgType as 'text' | 'voice' | 'image' | 'file' | 'merged' | 'sticker' | 'link' | 'video' | 'location' | 'card';
    const saved = db.createMessage({
      conversationId, senderId, msgType: safeMsgType, content, audioPath, imagePath, videoPath, duration,
      transcript: typeof transcript === 'string' ? transcript : undefined,
      meta: meta !== undefined ? meta : undefined,
      fileName: typeof fileName === 'string' ? fileName : undefined,
      fileSize: typeof fileSize === 'number' ? fileSize : undefined,
      fileMime: typeof fileMime === 'string' ? fileMime : undefined,
      filePath: typeof filePath === 'string' ? filePath : undefined,
      id: clientId,
    });
    const message = db.serializeMessage(saved);
    res.json({ message, clientId: clientId || null });
    // 实时同步：新消息广播给其他端；并广播已读回执更新（对端收到后刷新我的消息已读状态）
    wsBroadcast(conversationId, { type: 'message:new', message, clientId: clientId || null });
    wsBroadcast(conversationId, { type: 'message:read', conversationId });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '发送消息失败' });
  }
});

// 搜索消息（全局或限定会话）
app.get("/api/messages/search", (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const conversationId = req.query.conversationId ? String(req.query.conversationId) : undefined;
    if (q.length < 1) return res.json({ results: [] });
    const results = db.searchMessages(q, conversationId);
    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '搜索失败' });
  }
});

// 撤回 / 编辑消息（仅本人发送的消息）
app.patch("/api/conversations/:id/messages/:msgId", (req, res) => {
  try {
    const conversationId = req.params.id;
    const msgId = req.params.msgId;
    const { action, senderId, content } = req.body;
    const msg = db.getMessage(msgId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    if (msg.conversation_id !== conversationId) return res.status(400).json({ error: '消息与会话不匹配' });
    if (action === 'recall') {
      if (msg.sender_id !== senderId) return res.status(403).json({ error: '只能撤回自己发送的消息' });
      const created = new Date(msg.created_at).getTime();
      if (Date.now() - created > 2 * 60 * 1000) return res.status(400).json({ error: '超过 2 分钟，无法撤回' });
      db.recallMessage(msgId);
      const message = db.serializeMessage(db.getMessage(msgId)!);
      res.json({ message });
      wsBroadcast(conversationId, { type: 'message:update', message });
      const conv = db.getConversation(conversationId);
      if (conv) wsBroadcast(conversationId, { type: 'conversation:update', conversation: db.serializeConversation(conv) });
      return;
    }
    if (action === 'edit') {
      if (msg.sender_id !== senderId) return res.status(403).json({ error: '只能编辑自己发送的消息' });
      if (msg.msg_type !== 'text') return res.status(400).json({ error: '仅支持编辑文本消息' });
      if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: '内容不能为空' });
      db.editMessage(msgId, content.trim());
      const message = db.serializeMessage(db.getMessage(msgId)!);
      res.json({ message });
      wsBroadcast(conversationId, { type: 'message:update', message });
      return;
    }
    res.status(400).json({ error: '未知 action' });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '操作失败' });
  }
});

// 删除单条消息
app.delete("/api/conversations/:id/messages/:msgId", (req, res) => {
  try {
    const ok = db.deleteMessage(req.params.msgId);
    res.json({ success: ok });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '删除消息失败' });
  }
});

// 表情 reaction（切换：已选则取消）
app.post("/api/conversations/:id/messages/:msgId/reaction", (req, res) => {
  try {
    const { emoji, userId } = req.body;
    if (!emoji || !userId) return res.status(400).json({ error: '缺少 emoji/userId' });
    db.toggleReaction(req.params.msgId, emoji, userId);
    const message = db.serializeMessage(db.getMessage(req.params.msgId)!);
    res.json({ message });
    wsBroadcast(req.params.id, { type: 'message:update', message });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '操作失败' });
  }
});

// 清空会话全部消息（保留会话）
app.delete("/api/conversations/:id/messages", (req, res) => {
  try {
    db.clearConversationMessages(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '清空会话失败' });
  }
});

// 添加群成员
app.post("/api/conversations/:id/participants", (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: '缺少 contactId' });
    db.addParticipant(req.params.id, contactId);
    const conv = db.getConversation(req.params.id);
    if (conv) wsBroadcast(req.params.id, { type: 'conversation:update', conversation: db.serializeConversation(conv) });
    res.json({ participantIds: db.getConversationParticipants(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '添加成员失败' });
  }
});

// 移除群成员
app.delete("/api/conversations/:id/participants/:contactId", (req, res) => {
  try {
    const ok = db.removeParticipant(req.params.id, req.params.contactId);
    const conv = db.getConversation(req.params.id);
    if (conv) wsBroadcast(req.params.id, { type: 'conversation:update', conversation: db.serializeConversation(conv) });
    res.json({ success: ok, participantIds: db.getConversationParticipants(req.params.id) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '移除成员失败' });
  }
});

// ============= 收藏（消息收藏） =============
function serializeFavorite(f: any) {
  const sender = f.sender_id ? db.getContact(f.sender_id) : undefined;
  return {
    id: f.id,
    messageId: f.message_id,
    conversationId: f.conversation_id,
    senderId: f.sender_id,
    senderName: sender ? sender.name : (f.sender_id === db.ME_ID ? '我' : (f.sender_id || '')),
    msgType: f.msg_type,
    content: f.content,
    imagePath: f.image_path,
    fileName: f.file_name,
    filePath: f.file_path,
    createdAt: f.created_at,
  };
}

// 收藏一条消息（幂等：重复收藏不报错，返回已存在的记录）
app.post("/api/favorites", (req, res) => {
  try {
    const { messageId, conversationId } = req.body || {};
    if (!messageId || !conversationId) return res.status(400).json({ error: '缺少 messageId / conversationId' });
    const existing = db.getAllFavorites().find(f => f.message_id === messageId);
    if (existing) return res.json({ favorite: serializeFavorite(existing), already: true });
    const msg = db.getMessage(messageId);
    if (!msg) return res.status(404).json({ error: '消息不存在' });
    const fav = db.addFavorite({
      messageId, conversationId,
      senderId: msg.sender_id, msgType: msg.msg_type, content: msg.content,
      imagePath: msg.image_path, fileName: msg.file_name, filePath: msg.file_path,
    });
    res.json({ favorite: serializeFavorite(fav) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '收藏失败' });
  }
});

app.get("/api/favorites", (req, res) => {
  try {
    const favorites = db.getAllFavorites().map(serializeFavorite);
    res.json({ favorites });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取收藏失败' });
  }
});

app.delete("/api/favorites/:id", (req, res) => {
  try {
    const ok = db.deleteFavorite(req.params.id);
    res.json({ success: ok });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '取消收藏失败' });
  }
});

// 一键全部已读（批量标记所有会话的消息为已读）
app.post("/api/conversations/read-all", (req, res) => {
  try {
    const convs = db.getAllConversations();
    for (const c of convs) db.markConversationRead(c.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '操作失败' });
  }
});

// ============= 数据导出（全量聊天记录，用于备份 / 迁移） =============
// 返回 { contacts, conversations, messages } 的 JSON 快照；前端据此生成文件下载。
// 注意：媒体文件（语音/图片/视频/文件）本身不含在内，仅导出其服务端文件名引用。
app.get("/api/export", (req, res) => {
  try {
    const contacts = db.getAllContacts();
    const conversations = db.getAllConversations();
    const messages: any[] = [];
    for (const c of conversations) {
      const msgs = db.getMessagesByConversation(c.id).map(db.serializeMessage);
      messages.push(...msgs);
    }
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      contacts,
      conversations,
      messages,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '导出失败' });
  }
});

// ============= 朋友圈（Moments） =============
// 朋友圈图片上传（写入 data/moments，返回文件名）
app.post("/api/moments/image/upload", (req, res) => {
  try {
    const { image, ext = 'png' } = req.body;
    if (!image || typeof image !== 'string') return res.status(400).json({ error: '缺少 image(base64)' });
    const cleanExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const buffer = Buffer.from(image, 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片过大（上限 8MB）' });
    const filename = `${uuidv4()}.${cleanExt}`;
    fs.writeFileSync(path.join(db.MOMENTS_IMAGE_UPLOADS_DIR, filename), buffer);
    res.json({ imagePath: filename });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '朋友圈图片上传失败' });
  }
});

app.get("/api/moments/image/:file", (req, res) => {
  try {
    const file = req.params.file;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad');
    const filepath = path.join(db.MOMENTS_IMAGE_UPLOADS_DIR, file);
    if (!fs.existsSync(filepath)) return res.status(404).send('not found');
    const ext = file.split('.').pop() || 'png';
    res.setHeader('Content-Type', IMAGE_EXT_CONTENT[ext] || 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filepath).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).send('server error');
  }
});

// 拉取时间线（me + 联系人动态），支持分页游标
app.get("/api/moments", (req, res) => {
  try {
    const beforeCreated = req.query.beforeCreated as string | undefined;
    const beforeId = req.query.beforeId as string | undefined;
    const before = beforeCreated && beforeId ? { createdAt: beforeCreated, id: beforeId } : null;
    const result = db.getMoments(before, 30);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '获取朋友圈失败' });
  }
});

// 发布动态（仅 me 可发）
app.post("/api/moments", (req, res) => {
  try {
    const { content, images } = req.body;
    if ((!content || !String(content).trim()) && (!Array.isArray(images) || images.length === 0)) {
      return res.status(400).json({ error: '动态不能为空（文字或图片至少一项）' });
    }
    const moment = db.createMoment({
      authorId: db.ME_ID,
      content: content ? String(content).slice(0, 2000) : null,
      images: Array.isArray(images) ? images.filter((x: unknown) => typeof x === 'string').slice(0, 9) : [],
    });
    res.json({ moment });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '发布动态失败' });
  }
});

// 删除自己的动态
app.delete("/api/moments/:id", (req, res) => {
  try {
    const m = db.getMoment(req.params.id);
    if (!m) return res.status(404).json({ error: '动态不存在' });
    if (m.authorId !== db.ME_ID) return res.status(403).json({ error: '只能删除自己的动态' });
    const ok = db.deleteMoment(req.params.id);
    res.json({ success: ok });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '删除动态失败' });
  }
});

// 点赞 / 取消点赞
app.post("/api/moments/:id/like", (req, res) => {
  try {
    const m = db.getMoment(req.params.id);
    if (!m) return res.status(404).json({ error: '动态不存在' });
    const result = db.toggleMomentLike(req.params.id, db.ME_ID);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '操作失败' });
  }
});

// 评论 / 回复评论
app.post("/api/moments/:id/comment", (req, res) => {
  try {
    const { content, replyTo } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ error: '评论不能为空' });
    const comment = db.addMomentComment({
      momentId: req.params.id,
      authorId: db.ME_ID,
      replyTo: replyTo || null,
      content: String(content).slice(0, 500),
    });
    if (!comment) return res.status(404).json({ error: '动态不存在' });
    res.json({ comment });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '评论失败' });
  }
});

// ============= 语音上传 / 播放 =============
const VOICE_EXT_CONTENT: Record<string, string> = {
  webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};
app.post("/api/voice/upload", (req, res) => {
  try {
    const { audio, duration, ext = 'webm' } = req.body;
    if (!audio || typeof audio !== 'string') return res.status(400).json({ error: '缺少 audio(base64)' });
    const cleanExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
    const buffer = Buffer.from(audio, 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: '语音过大（上限 8MB）' });
    const filename = `${uuidv4()}.${cleanExt}`;
    fs.writeFileSync(path.join(db.UPLOADS_DIR, filename), buffer);
    res.json({ audioPath: filename, duration: duration || null });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '语音上传失败' });
  }
});

app.get("/api/voice/:file", (req, res) => {
  try {
    const file = req.params.file;
    // 防目录穿越
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad');
    const filepath = path.join(db.UPLOADS_DIR, file);
    if (!fs.existsSync(filepath)) return res.status(404).send('not found');
    const ext = file.split('.').pop() || 'webm';
    res.setHeader('Content-Type', VOICE_EXT_CONTENT[ext] || 'audio/webm');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filepath).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).send('server error');
  }
});

// 图片上传（写入 data/image，返回文件名）
const IMAGE_EXT_CONTENT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
};
app.post("/api/image/upload", (req, res) => {
  try {
    const { image, ext = 'png' } = req.body;
    if (!image || typeof image !== 'string') return res.status(400).json({ error: '缺少 image(base64)' });
    const cleanExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
    const filename = `${uuidv4()}.${cleanExt}`;
    const buffer = Buffer.from(image, 'base64');
    if (buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: '图片过大（上限 8MB）' });
    fs.writeFileSync(path.join(db.IMAGE_UPLOADS_DIR, filename), buffer);
    res.json({ imagePath: filename });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '图片上传失败' });
  }
});

app.get("/api/image/:file", (req, res) => {
  try {
    const file = req.params.file;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad');
    const filepath = path.join(db.IMAGE_UPLOADS_DIR, file);
    if (!fs.existsSync(filepath)) return res.status(404).send('not found');
    const ext = file.split('.').pop() || 'png';
    res.setHeader('Content-Type', IMAGE_EXT_CONTENT[ext] || 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filepath).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).send('server error');
  }
});

// ============= 视频上传 / 播放 =============
const VIDEO_EXT_CONTENT: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4',
};
app.post("/api/video/upload", (req, res) => {
  try {
    const { video, ext = 'mp4' } = req.body;
    if (!video || typeof video !== 'string') return res.status(400).json({ error: '缺少 video(base64)' });
    const cleanExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
    const buffer = Buffer.from(video, 'base64');
    if (buffer.length > 200 * 1024 * 1024) return res.status(413).json({ error: '视频过大（上限 200MB）' });
    const filename = `${uuidv4()}.${cleanExt}`;
    fs.writeFileSync(path.join(db.VIDEO_UPLOADS_DIR, filename), buffer);
    res.json({ videoPath: filename });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '视频上传失败' });
  }
});

app.get("/api/video/:file", (req, res) => {
  try {
    const file = req.params.file;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad');
    const filepath = path.join(db.VIDEO_UPLOADS_DIR, file);
    if (!fs.existsSync(filepath)) return res.status(404).send('not found');
    const ext = file.split('.').pop() || 'mp4';
    res.setHeader('Content-Type', VIDEO_EXT_CONTENT[ext] || 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filepath).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).send('server error');
  }
});

// ============= 文件上传 / 下载（文档 / 压缩包等） =============
const FILE_MIME_HINT: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed',
  json: 'application/json', mp4: 'video/mp4', mp3: 'audio/mpeg', bin: 'application/octet-stream',
};
app.post("/api/file/upload", (req, res) => {
  try {
    const { file, ext = 'bin', name = 'file' } = req.body;
    if (!file || typeof file !== 'string') return res.status(400).json({ error: '缺少 file(base64)' });
    const cleanExt = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const buffer = Buffer.from(file, 'base64');
    if (buffer.length > 50 * 1024 * 1024) return res.status(413).json({ error: '文件过大（上限 50MB）' });
    const filename = `${uuidv4()}.${cleanExt}`;
    fs.writeFileSync(path.join(db.FILE_UPLOADS_DIR, filename), buffer);
    res.json({ filePath: filename, name: String(name).slice(0, 200), size: buffer.length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || '文件上传失败' });
  }
});

app.get("/api/file/:file", (req, res) => {
  try {
    const file = req.params.file;
    if (file.includes('..') || file.includes('/') || file.includes('\\')) return res.status(400).send('bad');
    const filepath = path.join(db.FILE_UPLOADS_DIR, file);
    if (!fs.existsSync(filepath)) return res.status(404).send('not found');
    const ext = file.split('.').pop() || 'bin';
    res.setHeader('Content-Type', FILE_MIME_HINT[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filepath).pipe(res);
  } catch (error: any) {
    if (!res.headersSent) res.status(500).send('server error');
  }
});

// ============= 远程桌面「双开自连」信令服务（内存态，仅本机） =============
// 两个浏览器窗口/标签页通过房间码配对，交换 SDP / ICE，建立真实 WebRTC 连接。
interface SignalMsg { id: number; from: string; to: string; type: 'offer' | 'answer' | 'ice'; payload: any; }
interface RemoteRoom {
  code: string;
  createdAt: number;
  peers: Map<string, 'controller' | 'controlled'>;
  messages: SignalMsg[];
  seq: number;
}
const remoteRooms = new Map<string, RemoteRoom>();
const ROOM_TTL_MS = 15 * 60 * 1000; // 房间最大存活时间
const ROOM_SWEEP_MS = 60 * 1000; // 过期清理周期
const ROOM_MAX_MESSAGES = 500; // 单个房间信令缓冲上限（防止慢轮询无限堆积）

function genRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  // 带上限的碰撞重试，避免极端情况下死循环
  for (let attempt = 0; attempt < 50; attempt++) {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!remoteRooms.has(code)) return code;
  }
  return code;
}

// 周期性清理过期房间，避免内存泄漏
const roomSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of remoteRooms) {
    if (now - room.createdAt > ROOM_TTL_MS) remoteRooms.delete(code);
  }
}, ROOM_SWEEP_MS);
// 后台清理定时器，不应阻止进程退出（测试 / 优雅关闭）。server.listen 仍会保持事件循环存活。
roomSweepTimer.unref?.();

app.post('/api/remote/room', (req, res) => {
  const role: 'controller' | 'controlled' = req.body?.role === 'controlled' ? 'controlled' : 'controller';
  const code = genRoomCode();
  const peerId = uuidv4();
  const room: RemoteRoom = { code, createdAt: Date.now(), peers: new Map([[peerId, role]]), messages: [], seq: 0 };
  remoteRooms.set(code, room);
  res.json({ roomCode: code, peerId, role });
});

app.post('/api/remote/room/:code/join', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = remoteRooms.get(code);
  if (!room) return res.status(404).json({ error: '房间不存在或已过期' });
  if (Date.now() - room.createdAt > ROOM_TTL_MS) { remoteRooms.delete(code); return res.status(410).json({ error: '房间已过期' }); }
  if (room.peers.size >= 2) return res.status(409).json({ error: '房间已满（最多 2 人）' });
  // 另一角色才能加入（控制端 ↔ 被控端）
  const existing = Array.from(room.peers.values());
  const joinRole: 'controller' | 'controlled' = existing.includes('controller') ? 'controlled' : 'controller';
  const peerId = uuidv4();
  room.peers.set(peerId, joinRole);
  const controllerPeerId = Array.from(room.peers.entries()).find(([, r]) => r === 'controller')?.[0] || '';
  res.json({ roomCode: code, peerId, role: joinRole, controllerPeerId });
});

// 取发给我的信令消息（轮询；lastId 之后）
app.get('/api/remote/room/:code/signal', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = remoteRooms.get(code);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const peer = String(req.query.peer || '');
  const lastId = Number(req.query.lastId || 0);
  const msgs = room.messages.filter(m => m.to === peer && m.id > lastId);
  res.json({ messages: msgs });
});

// 发送信令消息（offer/answer/ice）给另一对等端
const SIGNAL_TYPES = new Set(['offer', 'answer', 'ice']);
app.post('/api/remote/room/:code/signal', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = remoteRooms.get(code);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  const { from, to, type, payload } = req.body || {};
  if (!from || !to || !type) return res.status(400).json({ error: '缺少 from/to/type' });
  if (!room.peers.has(from) || !room.peers.has(to)) return res.status(400).json({ error: 'from/to 不属于该房间' });
  if (!SIGNAL_TYPES.has(type)) return res.status(400).json({ error: '不支持的信令类型' });
  const id = ++room.seq;
  room.messages.push({ id, from, to, type, payload });
  // 限制缓冲长度，丢弃最旧信令，避免慢轮询导致内存无限增长
  if (room.messages.length > ROOM_MAX_MESSAGES) {
    room.messages.splice(0, room.messages.length - ROOM_MAX_MESSAGES);
  }
  res.json({ id });
});

// ============= 会话内 Agent 流式对话 =============
interface PendingChat {
  conversationId: string;
  userMessageId: string;
  agentMessageId: string;
  assistantFull: string;
  toolCalls: any[];
  agentSessionId: string | null;
}

app.post("/api/conversations/:id/agent", async (req, res) => {
  const { id: conversationId } = req.params;
  const { message, model, systemPrompt, permissionMode, cwd, remoteAssist } = req.body;
  if (!message) return res.status(400).json({ error: '消息不能为空' });

  const conversation = db.getConversation(conversationId);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });

  // 标记为远程协助激活
  if (remoteAssist) {
    db.updateConversation(conversationId, { remote_assist_active: 1 });
  }

  const now = new Date().toISOString();
  const userMessageId = uuidv4();
  const agentMessageId = uuidv4();
  const selectedModel = model || defaultModel;

  db.createMessage({ conversationId, senderId: db.ME_ID, msgType: 'text', content: message });

  // Agent 系统提示词（远程协助模式强化本机操作）
  let sysPrompt = systemPrompt ||
    '你是「星火助手」，一个内置在聊天应用里的 AI 助理，乐于帮助用户解决编程、办公与日常问题。请用简洁清晰的方式回答。';
  if (remoteAssist) {
    sysPrompt = '你正在通过「远程协助」帮用户操作他的本机电脑。请先用一句话说明你打算做什么，' +
      '然后用工具（如执行命令、读写文件）去完成。每一步都要简洁，遇到风险操作先提示。你可以直接执行，无需逐项征求同意。';
  }

  const workingDir = cwd || process.cwd();
  const permMode = remoteAssist ? 'bypassPermissions' : (permissionMode || 'default');

  // 连接状态跟踪：客户端断开后停止写入并清理挂起的权限请求，避免内存泄漏与工具审批永久挂起
  let clientGone = false;
  let finished = false;
  const safeWrite = (s: string) => {
    if (clientGone || res.writableEnded) return;
    try { res.write(s); } catch { /* 写入已失败，忽略 */ }
  };
  const cleanupPending = () => {
    for (const [rid, p] of pendingPermissions) {
      if (p.conversationId === conversationId) {
        pendingPermissions.delete(rid);
        try { p.resolve({ behavior: 'deny', message: '连接已断开' }); } catch { /* ignore */ }
      }
    }
  };
  // 本机远程协助结束：把会话的「协助中」状态归零，避免徽标永久显示
  const clearRemoteAssist = () => {
    if (!remoteAssist) return;
    try { db.updateConversation(conversationId, { remote_assist_active: 0 }); } catch { /* ignore */ }
  };
  res.on('close', () => {
    clientGone = true;
    cleanupPending();
    clearRemoteAssist();
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  safeWrite(`data: ${JSON.stringify({ type: "init", agentMessageId, model: selectedModel })}\n\n`);

  const canUseTool: CanUseTool = async (toolName, input, options) => {
    if (permMode === 'bypassPermissions') {
      return { behavior: 'allow', updatedInput: input };
    }
    if (clientGone) return { behavior: 'deny', message: '连接已断开' };
    const requestId = uuidv4();
    safeWrite(`data: ${JSON.stringify({
      type: "permission_request", requestId, toolUseId: options.toolUseID,
      toolName, input, conversationId, timestamp: Date.now(),
    })}\n\n`);
    return new Promise<PermissionResult>((resolve) => {
      pendingPermissions.set(requestId, {
        resolve, reject: () => {}, toolName, input, conversationId, timestamp: Date.now(),
      });
      setTimeout(() => {
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
          resolve({ behavior: 'deny', message: '权限请求超时' });
        }
      }, PERMISSION_TIMEOUT);
    });
  };

  let fullResponse = "";
  let toolCalls: any[] = [];
  let newSdkSessionId: string | null = null;
  let currentToolId: string | null = null;

  // 本机远程协助：挂载原生键鼠注入工具，让 Agent 能驱动 GUI（仅此模式，不污染普通会话）
  const queryOptions: Record<string, unknown> = {
    cwd: workingDir,
    model: selectedModel,
    maxTurns: 12,
    systemPrompt: sysPrompt,
    permissionMode: permMode as any,
    canUseTool,
  };
  // 本机远程协助：挂载原生键鼠注入工具；跨机远程协助：若该会话已发起，挂载 remote_action 工具。
  const mcpServers: Record<string, any> = {};
  if (remoteAssist) {
    try {
      mcpServers["native-input"] = buildRemoteAssistMcpServer();
    } catch (e: any) {
      console.warn("[agent] 挂载原生注入工具失败，Agent 将仅靠 CLI 工具：", e?.message || e);
    }
  }
  const remoteSessionId = getSessionIdByConversation(conversationId);
  if (remoteSessionId) {
    try {
      mcpServers["remote-action"] = buildRemoteActionMcpServer(conversationId);
    } catch (e: any) {
      console.warn("[agent] 挂载跨机远程操作工具失败：", e?.message || e);
    }
  }
  if (Object.keys(mcpServers).length) {
    queryOptions.mcpServers = mcpServers;
  }

  try {
    const stream = query({ prompt: message, options: queryOptions as any });

    for await (const msg of stream) {
      if (clientGone) break; // 客户端已断开，停止消费流
      if (msg.type === "system" && (msg as any).subtype === "init") {
        newSdkSessionId = (msg as any).session_id;
      } else if (msg.type === "assistant") {
        const content = (msg as any).message?.content;
        if (typeof content === "string") {
          fullResponse += content;
          safeWrite(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += block.text;
              safeWrite(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`);
            } else if (block.type === "tool_use") {
              currentToolId = block.id || uuidv4();
              const toolCall = { id: currentToolId, name: block.name, input: (block as any).input || {}, status: "running" };
              toolCalls.push(toolCall);
              safeWrite(`data: ${JSON.stringify({ type: "tool", id: toolCall.id, name: toolCall.name, input: toolCall.input, status: "running" })}\n\n`);
            }
          }
        }
      } else if ((msg.type as string) === "tool_result") {
        const m: any = msg;
        const toolId = m.tool_use_id || currentToolId;
        const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
        if (tool) {
          tool.status = m.is_error ? "error" : "completed";
          tool.isError = m.is_error;
          tool.result = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          safeWrite(`data: ${JSON.stringify({ type: "tool_result", toolId: tool.id, content: tool.result, isError: m.is_error })}\n\n`);
        }
        currentToolId = null;
      } else if (msg.type === "result") {
        toolCalls.forEach(t => { if (t.status === "running") { t.status = "completed"; safeWrite(`data: ${JSON.stringify({ type: "tool_result", toolId: t.id, content: t.result || "已完成" })}\n\n`); } });
        safeWrite(`data: ${JSON.stringify({ type: "done", duration: (msg as any).duration, cost: (msg as any).cost })}\n\n`);
      }
    }

    if (!clientGone) {
      db.createMessage({
        conversationId, senderId: AGENT_CONTACT_ID, msgType: 'agent',
        content: fullResponse || '(无文本回复)', toolCalls: toolCalls.length ? JSON.stringify(toolCalls) : undefined,
        agentSessionId: newSdkSessionId ?? undefined,
      });
    }

    finished = true;
    clearRemoteAssist();
    if (!clientGone && !res.writableEnded) res.end();
  } catch (error: any) {
    const errorMessage = error?.message || "处理请求时发生错误";
    // 识别"未登录 / 凭证缺失"类错误，给出可操作的下一步提示
    const lowered = errorMessage.toLowerCase();
    const isAuthError = lowered.includes('login') || lowered.includes('auth') || lowered.includes('token') ||
      lowered.includes('unauthorized') || lowered.includes('api key') || lowered.includes('credential') ||
      lowered.includes('not authenticated') || lowered.includes('鉴权') || lowered.includes('未登录');
    const hint = isAuthError
      ? '\n\n请先在右上角「设置」中配置 CodeBuddy API Key / Auth Token，或在终端执行 codebuddy login 后重试。'
      : '';
    const content = `⚠️ ${errorMessage}${hint}`;
    if (!clientGone) {
      // 出错也落一条 agent 消息，避免前端卡在"思考中"
      db.createMessage({ conversationId, senderId: AGENT_CONTACT_ID, msgType: 'agent', content });
    }
    finished = true;
    clearRemoteAssist();
    if (!clientGone && !res.writableEnded) {
      safeWrite(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
      res.end();
    }
  }
});

// 权限响应
app.post("/api/permission-response", (req, res) => {
  const { requestId, behavior, message } = req.body;
  const pending = pendingPermissions.get(requestId);
  if (!pending) return res.status(404).json({ error: "权限请求不存在或已超时" });
  pendingPermissions.delete(requestId);
  if (behavior === 'allow') pending.resolve({ behavior: 'allow', updatedInput: pending.input });
  else pending.resolve({ behavior: 'deny', message: message || '用户拒绝了此操作' });
  res.json({ success: true });
});

// ============= 远程协助信令（WebRTC 已改为单页本机回路，无需后端信令） =============

// ============= 原生键鼠注入助手管理（仅本机，启动/停止被控端原生进程） =============
// 前端「被控端」面板可一键启动/停止项目自带的 native-assistant/assist-helper.js，
// 后端仅按硬编码路径 spawn，并记录 PID 以支持停止；绝不执行任意命令。
app.get("/api/native-assistant/status", (_req, res) => {
  res.json(nativeAssistant.getStatus());
});
app.post("/api/native-assistant/start", (_req, res) => {
  res.json(nativeAssistant.start());
});
app.post("/api/native-assistant/stop", (_req, res) => {
  res.json(nativeAssistant.stop());
});

// ============= 跨机远程协助：会话创建 + action 中继（服务端中转） =============
// 被控端「发起远程协助」→ 创建 session（按 conversationId 绑定）；其浏览器标签页轮询
// 待执行 action 并经本地原生助手执行，回传结果。控制端（星火助手）经 remote_action
// 工具把指令入队，等待被控端取走执行。无需 TURN，部署一个可达服务器即可跨机。
app.post('/api/remote/session', (req, res) => {
  const conversationId = String(req.body?.conversationId || '');
  if (!conversationId) return res.status(400).json({ error: '缺少 conversationId' });
  if (!db.getConversation(conversationId)) return res.status(404).json({ error: '会话不存在' });
  const { sessionId } = createSession(conversationId);
  res.json({ sessionId, conversationId });
});

app.get('/api/remote/session', (req, res) => {
  const conversationId = String(req.query.conversationId || '');
  res.json({ sessionId: getSessionIdByConversation(conversationId) || null });
});

app.get('/api/remote/session/:sessionId/actions', (req, res) => {
  const sessionId = String(req.params.sessionId || '');
  const lastId = String(req.query.lastId || '');
  const actions = fetchPendingActions(sessionId, lastId);
  res.json({ actions, lastId: actions.length ? actions[actions.length - 1].id : lastId });
});

// 审计查询：被控端事后核查控制端在自己机器上的操作（未知 sessionId 返空数组）
app.get('/api/remote/session/:sessionId/audit', (req, res) => {
  const sessionId = String(req.params.sessionId || '');
  res.json({ audit: getAudit(sessionId) });
});

// 审计账本：按会话查全部远程协助操作（跨多次协助，进程重启后仍可查）
app.get('/api/remote/audit', (req, res) => {
  const conversationId = String(req.query.conversationId || '');
  if (!conversationId) return res.status(400).json({ error: '缺少 conversationId' });
  res.json({ audit: db.getRemoteAuditByConversation(conversationId) });
});

app.post('/api/remote/session/:sessionId/result', (req, res) => {
  const sessionId = String(req.params.sessionId || '');
  const { actionId, ok, output, error } = req.body || {};
  if (!actionId) return res.status(400).json({ error: '缺少 actionId' });
  const okSubmit = submitResult(sessionId, actionId, { ok: !!ok, output, error });
  if (!okSubmit) return res.status(404).json({ error: 'action 不存在或已处理' });
  res.json({ success: true });
});

app.post('/api/remote/session/close', (req, res) => {
  const conversationId = String(req.body?.conversationId || '');
  closeSession(conversationId);
  res.json({ success: true });
});

// ============= 生产环境：托管前端构建产物（dist） =============
// 仅当 vite build 产物存在时启用（开发模式由 Vite dev server 托管前端，故跳过；
// 测试环境 dist 不存在也自动跳过，不影响接口测试）。
// 鉴权中间件已收窄到 /api，因此此处托管的 index.html 与静态资源均为公开访问。
const DIST_DIR = path.resolve(__dirname, "..", "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }));
  // SPA 回退：非 /api 的请求统一返回 index.html，交给前端路由处理。
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ============= 启动服务器 =============
// 监听 127.0.0.1（仅本机可访问），并挂载 WebSocket 实时同步。
// 测试环境（NODE_ENV=test）不自动启动，由测试按需调用 startServer() 做集成验证。
export function startServer(port: number = PORT, host: string = '127.0.0.1'): http.Server {
  const server = http.createServer(app);
  // WebSocket 实时同步：路径 /ws?conversationId=xxx，按会话订阅。
  // verifyClient 复用与 HTTP 一致的安全口径（server/security.ts）：本机 Origin + （可选）令牌校验。
  // 注：本机 @types/ws 未稳定导出 ServerOptions，故对选项对象做 as any 以兼容 verifyClient 回调标注。
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: (
      info: { origin: string | undefined; req: import('http').IncomingMessage; secure: boolean },
      cb: (res: boolean, code?: number, message?: string) => void,
    ) => {
      // S3：升级请求同样做 Origin 校验，挡住恶意网页借浏览器发起的跨站 WS 连接
      if (!isAllowedOrigin(info.origin)) {
        cb(false, 403, 'Forbidden: Origin not allowed');
        return;
      }
      // G3：配置了令牌时，从 query 参数取令牌校验（浏览器 WS 不便携带 Authorization 头）
      const url = new URL(info.req.url || '', 'http://localhost');
      const token = url.searchParams.get('token') || undefined;
      if (!isTokenValid(token)) {
        cb(false, 401, 'Unauthorized: invalid token');
        return;
      }
      cb(true);
    },
  } as any);
  activeServer = server;
  activeWss = wss;
  wss.on('connection', (ws, req) => {
    let conversationId = '';
    try {
      const url = new URL(req.url || '', 'http://localhost');
      conversationId = url.searchParams.get('conversationId') || '';
    } catch { /* ignore */ }
    if (!conversationId) { ws.close(); return; }
    if (!wsSubs.has(conversationId)) wsSubs.set(conversationId, new Set());
    wsSubs.get(conversationId)!.add(ws);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // 客户端上报的 typing 事件转发给同会话的其他端
        if (msg && msg.type === 'typing' && typeof msg.typing === 'boolean') {
          wsBroadcast(conversationId, { type: 'typing', senderId: msg.senderId, typing: msg.typing }, ws);
        }
      } catch { /* ignore */ }
    });
    ws.on('close', () => {
      const set = wsSubs.get(conversationId);
      if (set) { set.delete(ws); if (set.size === 0) wsSubs.delete(conversationId); }
    });
  });

  server.listen(port, host, () => {
    console.log(`
╔════════════════════════════════════════════╗
║     ◉ 星火聊天 API 已启动                    ║
║     地址: http://${host}:${port}             ║
║     WebSocket: ws://${host}:${port}/ws      ║
║     数据库: SQLite (data/chat.db)          ║
╚════════════════════════════════════════════╝
  `);
  });
  return server;
}

// 非测试环境自动启动
// 默认仅绑 127.0.0.1（本机安全）；容器化部署时通过 HOST=0.0.0.0 对外暴露。
// 收到 SIGINT/SIGTERM 时优雅停机（关 WS 客户端 + HTTP + SQLite），避免连接/文件句柄泄漏。
// 仅在真正需要常驻运行时启动：排除 vitest（VITEST 已设）与显式 test 环境，
// 防御 NODE_ENV=production 下误跑测试时触发 startServer() 导致 EADDRINUSE。
if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  startServer(PORT, process.env.HOST || '127.0.0.1');
  const onSignal = (sig: string) => {
    // 用同步写 stderr，确保停机日志在 process.exit 前落盘（异步 console.log 会被截断而丢失）
    try { process.stderr.write(`[spark] 收到 ${sig}，开始优雅停机...\n`); } catch { /* ignore */ }
    try { shutdownServer(); } catch { /* ignore */ }
    // 连接与文件句柄已释放，干净退出（退出码 0，便于编排器判定优雅停机成功）
    process.exit(0);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}
