import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径（测试可通过 SPARK_DB_PATH 指定临时库，避免污染开发数据）
const dbPath = process.env.SPARK_DB_PATH
  ? path.resolve(process.env.SPARK_DB_PATH)
  : path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 语音文件目录
export const UPLOADS_DIR = path.join(dataDir, 'voice');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 图片文件目录
export const IMAGE_UPLOADS_DIR = path.join(dataDir, 'image');
if (!fs.existsSync(IMAGE_UPLOADS_DIR)) {
  fs.mkdirSync(IMAGE_UPLOADS_DIR, { recursive: true });
}

// 创建数据库连接（显式标注类型，便于 composite 项目生成可命名的声明）
const db: Database.Database = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 联系人表（含本地用户"我"与 AI 助手）
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_text TEXT,
    avatar_color TEXT,
    is_agent INTEGER DEFAULT 0,
    agent_config TEXT,            -- JSON: {systemPrompt, permissionMode, model, cwd}
    status TEXT DEFAULT 'online', -- online | offline
    created_at TEXT NOT NULL
  );

  -- 会话表（单聊 direct / 群聊 group）
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- direct | group
    title TEXT,
    avatar_text TEXT,
    avatar_color TEXT,
    is_remote_assist INTEGER DEFAULT 0,
    remote_assist_active INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 会话参与者
  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (conversation_id, contact_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,      -- 'me' 或 contact.id（AI 助手即其 contact.id）
    msg_type TEXT NOT NULL,       -- text | voice | system | agent
    content TEXT,
    audio_path TEXT,
    duration INTEGER,             -- 语音时长(ms)
    tool_calls TEXT,              -- JSON 数组（agent 工具调用）
    agent_session_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
`);

  // #7 语音转写文本列：旧库通过 ALTER 补齐（列已存在则忽略）
  try { db.prepare('ALTER TABLE messages ADD COLUMN transcript TEXT').run(); } catch {}

// ============= 类型定义 =============
export interface DbContact {
  id: string;
  name: string;
  avatar_text: string | null;
  avatar_color: string | null;
  is_agent: number;             // 0 | 1
  agent_config: string | null;  // JSON
  status: string;
  created_at: string;
}

export interface DbConversation {
  id: string;
  type: string;                 // direct | group
  title: string | null;
  avatar_text: string | null;
  avatar_color: string | null;
  is_remote_assist: number;     // 0 | 1
  remote_assist_active: number; // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  msg_type: string;
  content: string | null;
  transcript: string | null;
  audio_path: string | null;
  duration: number | null;
  tool_calls: string | null;
  agent_session_id: string | null;
  image_path: string | null;
  meta: string | null;
  read: number;
  read_at: string | null;
  created_at: string;
}

export interface AgentConfig {
  systemPrompt: string;
  permissionMode: string;
  model: string;
  cwd?: string;
}

// 本地用户常量
export const ME_ID = 'me';

// ============= 种子数据 =============
function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) as c FROM contacts').get() as { c: number }).c;
  if (count > 0) return;

  const now = new Date().toISOString();
  const insertContact = db.prepare(`
    INSERT INTO contacts (id, name, avatar_text, avatar_color, is_agent, agent_config, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 本地用户
  insertContact.run(ME_ID, '我', '我', '#07c160', 0, null, 'online', now);

  // AI 助手（CodeBuddy Agent）
  const agentConfig: AgentConfig = {
    systemPrompt:
      '你是「星火助手」，一个内置在聊天应用里的 AI 助理。你乐于帮助用户解决编程、办公与日常问题。' +
      '当用户发起「远程协助」时，你将以 bypass 权限在本机执行命令、读写文件、排查问题，请先说明你要做什么，再动手，并保持简洁。',
    permissionMode: 'default',
    model: 'claude-sonnet-4',
    cwd: process.cwd(),
  };
  insertContact.run(
    'agent_xinghuo',
    '星火助手',
    '星',
    '#0052d9',
    1,
    JSON.stringify(agentConfig),
    'online',
    now
  );

  // 模拟人类联系人（单实例原型，演示用）
  const humans = [
    { id: 'u_alice', name: 'Alice', text: 'A', color: '#ff9c00' },
    { id: 'u_bob', name: 'Bob', text: 'B', color: '#7c5cff' },
    { id: 'u_carol', name: 'Carol', text: 'C', color: '#e34d59' },
  ];
  for (const h of humans) {
    insertContact.run(h.id, h.name, h.text, h.color, 0, null, 'online', now);
  }

  // 默认进入页：与星火助手的会话
  const welcomeId = uuidv4();
  db.prepare(`
    INSERT INTO conversations (id, type, title, avatar_text, avatar_color, is_remote_assist, remote_assist_active, created_at, updated_at)
    VALUES (?, 'direct', '星火助手', '星', '#0052d9', 0, 0, ?, ?)
  `).run(welcomeId, now, now);
  db.prepare('INSERT INTO conversation_participants (conversation_id, contact_id) VALUES (?, ?)').run(welcomeId, ME_ID);
  db.prepare('INSERT INTO conversation_participants (conversation_id, contact_id) VALUES (?, ?)').run(welcomeId, 'agent_xinghuo');

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, msg_type, content, audio_path, duration, tool_calls, agent_session_id, created_at)
    VALUES (?, ?, 'agent_xinghuo', 'system', '欢迎使用星火聊天 👋 你可以和朋友聊天、发语音，也可以直接和我（星火助手）对话，或发起「远程协助」让我帮你操作本机。', NULL, NULL, NULL, NULL, ?)
  `).run(uuidv4(), welcomeId, now);
}

// 迁移：为 messages 增加 read 列（旧库兼容）
const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!msgCols.some(c => c.name === 'read')) {
  db.exec("ALTER TABLE messages ADD COLUMN read INTEGER NOT NULL DEFAULT 0");
}
// 迁移：为 messages 增加 meta 列（转发来源等附加信息）
if (!msgCols.some(c => c.name === 'meta')) {
  db.exec("ALTER TABLE messages ADD COLUMN meta TEXT");
}
// 迁移：为 messages 增加 image_path 列（图片消息）
if (!msgCols.some(c => c.name === 'image_path')) {
  db.exec("ALTER TABLE messages ADD COLUMN image_path TEXT");
}
// 迁移：为 messages 增加 read_at 列（对方已读回执时间；NULL 表示未读）
if (!msgCols.some(c => c.name === 'read_at')) {
  db.exec("ALTER TABLE messages ADD COLUMN read_at TEXT");
}

seedIfEmpty();

// ============= 联系人操作 =============
export function getAllContacts(): DbContact[] {
  return db.prepare('SELECT * FROM contacts ORDER BY is_agent DESC, created_at ASC').all() as DbContact[];
}

export function getContact(id: string): DbContact | undefined {
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as DbContact | undefined;
}

export function getAgentContacts(): DbContact[] {
  return db.prepare('SELECT * FROM contacts WHERE is_agent = 1').all() as DbContact[];
}

// 新增联系人（人类，非 AI）
const CONTACT_COLORS = ['#ff9c00', '#7c5cff', '#e34d59', '#2ba471', '#0052d9', '#ed7b2f', '#0594fa', '#834ec2'];
export function createContact(input: { name: string; avatarText?: string; avatarColor?: string }): DbContact {
  const now = new Date().toISOString();
  const id = 'u_' + uuidv4().slice(0, 8);
  const avatarText = (input.avatarText || input.name.slice(0, 1).toUpperCase()).slice(0, 2);
  const avatarColor = input.avatarColor || CONTACT_COLORS[Math.floor(Math.random() * CONTACT_COLORS.length)];
  db.prepare(`
    INSERT INTO contacts (id, name, avatar_text, avatar_color, is_agent, status, created_at)
    VALUES (?, ?, ?, ?, 0, 'online', ?)
  `).run(id, input.name, avatarText, avatarColor, now);
  return getContact(id)!;
}

// 删除联系人（不能删自己或 AI 助手；同步移除其群成员关系）
export function deleteContact(id: string): boolean {
  if (id === ME_ID) return false;
  const c = getContact(id);
  if (!c || c.is_agent) return false;
  db.prepare('DELETE FROM conversation_participants WHERE contact_id = ?').run(id);
  const changes = db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes;
  return changes > 0;
}

// 更新联系人（名称/头像/AI 配置）。agentConfig 以对象传入，内部序列化为 JSON 存入 agent_config。
export function updateContact(
  id: string,
  updates: { name?: string; avatarText?: string; avatarColor?: string; agentConfig?: unknown },
): DbContact | undefined {
  const c = getContact(id);
  if (!c) return undefined;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.avatarText !== undefined) { sets.push('avatar_text = ?'); vals.push(updates.avatarText); }
  if (updates.avatarColor !== undefined) { sets.push('avatar_color = ?'); vals.push(updates.avatarColor); }
  if (updates.agentConfig !== undefined) { sets.push('agent_config = ?'); vals.push(JSON.stringify(updates.agentConfig)); }
  if (sets.length === 0) return c;
  vals.push(id);
  db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...(vals as unknown[]));
  return getContact(id);
}

// ============= 会话操作 =============
export function getAllConversations(): DbConversation[] {
  return db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as DbConversation[];
}

export function getConversation(id: string): DbConversation | undefined {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as DbConversation | undefined;
}

export function getConversationParticipants(conversationId: string): string[] {
  const rows = db.prepare('SELECT contact_id FROM conversation_participants WHERE conversation_id = ?').all(conversationId) as { contact_id: string }[];
  return rows.map(r => r.contact_id);
}

/**
 * 查找"我"与单个联系人的直接会话（去重用）
 */
export function findDirectConversation(contactId: string): DbConversation | undefined {
  const rows = db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id = c.id
    JOIN conversation_participants p2 ON p2.conversation_id = c.id
    WHERE c.type = 'direct'
      AND p1.contact_id = ?
      AND p2.contact_id = ?
    LIMIT 1
  `).all(ME_ID, contactId) as DbConversation[];
  return rows[0];
}

export interface CreateConversationInput {
  type: 'direct' | 'group';
  participantIds: string[]; // 不含 'me'，调用方会包含
  title?: string;
  avatarText?: string;
  avatarColor?: string;
  isRemoteAssist?: boolean;
}

export function createConversation(input: CreateConversationInput): DbConversation {
  const now = new Date().toISOString();
  const id = uuidv4();
  const title = input.title || (input.type === 'group' ? '群聊' : '会话');
  db.prepare(`
    INSERT INTO conversations (id, type, title, avatar_text, avatar_color, is_remote_assist, remote_assist_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    input.type,
    title,
    input.avatarText || null,
    input.avatarColor || null,
    input.isRemoteAssist ? 1 : 0,
    now,
    now
  );

  const insertParticipant = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, contact_id) VALUES (?, ?)');
  insertParticipant.run(id, ME_ID);
  for (const pid of input.participantIds) {
    insertParticipant.run(id, pid);
  }
  return getConversation(id)!;
}

export function updateConversation(id: string, updates: Partial<Pick<DbConversation, 'title' | 'avatar_text' | 'avatar_color' | 'remote_assist_active'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.avatar_text !== undefined) { fields.push('avatar_text = ?'); values.push(updates.avatar_text); }
  if (updates.avatar_color !== undefined) { fields.push('avatar_color = ?'); values.push(updates.avatar_color); }
  if (updates.remote_assist_active !== undefined) { fields.push('remote_assist_active = ?'); values.push(updates.remote_assist_active); }
  if (fields.length === 0) return false;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  const stmt = db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values).changes > 0;
}

export function deleteConversation(id: string): boolean {
  // 先收集媒体文件，再删除（FK 级联清消息），最后回收无引用的文件
  const media = db.prepare('SELECT audio_path, image_path FROM messages WHERE conversation_id = ?').all(id) as {
    audio_path: string | null;
    image_path: string | null;
  }[];
  const ok = db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  if (ok) {
    const seen = new Set<string>();
    for (const row of media) {
      if (row.audio_path && !seen.has('v:' + row.audio_path)) {
        seen.add('v:' + row.audio_path);
        maybeDeleteMediaFile(row.audio_path, 'voice');
      }
      if (row.image_path && !seen.has('i:' + row.image_path)) {
        seen.add('i:' + row.image_path);
        maybeDeleteMediaFile(row.image_path, 'image');
      }
    }
  }
  return ok;
}

// ============= 会话序列化（统一输出结构，避免各端点字段命名不一致） =============
export interface SerializedConversation {
  id: string;
  type: string;                  // direct | group
  title: string | null;
  avatarText: string | null;
  avatarColor: string | null;
  isRemoteAssist: boolean;
  remoteAssistActive: boolean;
  participantIds: string[];
  lastMessage: {
    content: string;
    msgType: string;
    senderId: string;
    createdAt: string;
    meta: any;
  } | null;
  messageCount: number;
  unreadCount: number;
}

// 取会话内最新一条消息（用于会话列表预览，避免加载全部消息）
export function getLastMessage(conversationId: string): DbMessage | undefined {
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conversationId) as DbMessage | undefined;
}

// 会话消息总数
export function getMessageCount(conversationId: string): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?').get(conversationId) as { c: number };
  return row.c;
}

// 将 DB 行序列化为前端统一使用的驼峰结构
export function serializeConversation(c: DbConversation): SerializedConversation {
  const last = getLastMessage(c.id);
  let lastMessage: SerializedConversation['lastMessage'] = null;
  if (last) {
    const preview =
      last.msg_type === 'voice' ? '[语音]' :
      last.msg_type === 'image' ? '[图片]' :
      (last.content || '').slice(0, 120);
    lastMessage = {
      content: preview,
      msgType: last.msg_type,
      senderId: last.sender_id,
      createdAt: last.created_at,
      meta: last.meta ? JSON.parse(last.meta) : null,
    };
  }
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    avatarText: c.avatar_text,
    avatarColor: c.avatar_color,
    isRemoteAssist: !!c.is_remote_assist,
    remoteAssistActive: !!c.remote_assist_active,
    participantIds: getConversationParticipants(c.id),
    lastMessage,
    messageCount: getMessageCount(c.id),
    unreadCount: getUnreadCount(c.id),
  };
}

// 将数据库行映射为前端使用的驼峰消息结构（与 GET /messages 保持一致，
// 避免 POST 直接返回 snake_case 导致刚发送的图片/语音无法立即渲染）。
export function serializeMessage(m: DbMessage) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    msgType: m.msg_type,
    content: m.content,
    transcript: m.transcript,
    audioPath: m.audio_path,
    imagePath: m.image_path,
    duration: m.duration,
    toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    agentSessionId: m.agent_session_id,
    createdAt: m.created_at,
    readAt: m.read_at,
    meta: m.meta ? JSON.parse(m.meta) : null,
  };
}

// 一次性聚合所有会话的列表信息（最新消息 / 消息数 / 未读数 / 参与者），
// 用 5 条聚合查询替代「每会话 4 条」的 N+1 查询。
export function getAllConversationsSerialized(): SerializedConversation[] {
  const convs = getAllConversations();
  if (convs.length === 0) return [];

  const convIds = convs.map((c) => c.id);
  const placeholders = convIds.map(() => '?').join(',');

  // 每条会话最新一条消息（窗口函数按 created_at 倒序取首条）
  const lastRows = db.prepare(`
    SELECT m.* FROM (
      SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC) as rn
      FROM messages m
      WHERE m.conversation_id IN (${placeholders})
    ) m WHERE m.rn = 1
  `).all(...convIds) as DbMessage[];

  // 消息总数
  const countRows = db.prepare(`
    SELECT conversation_id, COUNT(*) as c FROM messages
    WHERE conversation_id IN (${placeholders}) GROUP BY conversation_id
  `).all(...convIds) as { conversation_id: string; c: number }[];

  // 未读数（来自他人/助手且未读，系统消息不计）
  const unreadRows = db.prepare(`
    SELECT conversation_id, COUNT(*) as c FROM messages
    WHERE conversation_id IN (${placeholders}) AND sender_id != ? AND read = 0 AND msg_type != 'system'
    GROUP BY conversation_id
  `).all(...convIds, ME_ID) as { conversation_id: string; c: number }[];

  // 参与者
  const partRows = db.prepare(`
    SELECT conversation_id, GROUP_CONCAT(contact_id) as ids FROM conversation_participants
    WHERE conversation_id IN (${placeholders}) GROUP BY conversation_id
  `).all(...convIds) as { conversation_id: string; ids: string | null }[];

  const lastMap = new Map(lastRows.map((m) => [m.conversation_id, m]));
  const countMap = new Map(countRows.map((r) => [r.conversation_id, r.c]));
  const unreadMap = new Map(unreadRows.map((r) => [r.conversation_id, r.c]));
  const partMap = new Map(partRows.map((r) => [r.conversation_id, r.ids ? r.ids.split(',') : []]));

  return convs.map((c) => {
    const last = lastMap.get(c.id);
    let lastMessage: SerializedConversation['lastMessage'] = null;
    if (last) {
      const preview =
        last.msg_type === 'voice' ? '[语音]' :
        last.msg_type === 'image' ? '[图片]' :
        (last.content || '').slice(0, 120);
      lastMessage = {
        content: preview,
        msgType: last.msg_type,
        senderId: last.sender_id,
        createdAt: last.created_at,
        meta: last.meta ? JSON.parse(last.meta) : null,
      };
    }
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      avatarText: c.avatar_text,
      avatarColor: c.avatar_color,
      isRemoteAssist: !!c.is_remote_assist,
      remoteAssistActive: !!c.remote_assist_active,
      participantIds: partMap.get(c.id) || [],
      lastMessage,
      messageCount: countMap.get(c.id) || 0,
      unreadCount: unreadMap.get(c.id) || 0,
    };
  });
}

// ============= 消息操作 =============
export function getMessagesByConversation(conversationId: string): DbMessage[] {
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as DbMessage[];
}

// 分页拉取会话消息：before 为空取最新一页（倒序后取 limit 条）；before 提供时取更早的消息。
// 返回序列化消息（时间正序）、是否还有更早消息、以及本页最旧消息的游标（createdAt+id）。
export function getMessagesPage(
  conversationId: string,
  before: { createdAt: string; id: string } | null,
  limit: number,
): { messages: ReturnType<typeof serializeMessage>[]; hasMore: boolean; oldest: { createdAt: string; id: string } | null } {
  let rows: DbMessage[];
  if (before) {
    rows = db.prepare(`
      SELECT * FROM messages WHERE conversation_id = @conversationId
      AND (created_at < @bc OR (created_at = @bc AND id < @bid))
      ORDER BY created_at DESC, id DESC LIMIT @lim
    `).all({ conversationId, bc: before.createdAt, bid: before.id, lim: limit }) as DbMessage[];
  } else {
    rows = db.prepare(`
      SELECT * FROM messages WHERE conversation_id = @conversationId
      ORDER BY created_at DESC, id DESC LIMIT @lim
    `).all({ conversationId, lim: limit }) as DbMessage[];
  }
  const hasMore = (() => {
    if (rows.length < limit) return false;
    const oldest = rows[rows.length - 1];
    const rem = db.prepare(`
      SELECT COUNT(*) as c FROM messages WHERE conversation_id = @conversationId
      AND (created_at < @bc OR (created_at = @bc AND id < @bid))
    `).get({ conversationId, bc: oldest.created_at, bid: oldest.id }) as { c: number };
    return rem.c > 0;
  })();
  rows.reverse(); // 改为时间正序，便于前端直接拼接在头部
  const messages = rows.map(serializeMessage);
  const oldestMsg = rows[0];
  const oldestCursor = oldestMsg ? { createdAt: oldestMsg.created_at, id: oldestMsg.id } : null;
  return { messages, hasMore, oldest: oldestCursor };
}

export interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  msgType: 'text' | 'voice' | 'system' | 'agent' | 'image';
  content?: string;
  transcript?: string;
  audioPath?: string;
  imagePath?: string;
  duration?: number;
  toolCalls?: string;
  agentSessionId?: string;
  meta?: any;
  /** 可选：由客户端生成的消息 id（用于多端实时同步时前后端共用同一 id，避免重复） */
  id?: string;
}

export function createMessage(input: CreateMessageInput): DbMessage {
  // 多条写操作合并为一个事务，保证原子性（插入消息 / 更新会话时间 / 生成已读回执）
  const tx = db.transaction((inp: CreateMessageInput): DbMessage => {
    const id = inp.id || uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, msg_type, content, audio_path, image_path, duration, tool_calls, agent_session_id, transcript, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      inp.conversationId,
      inp.senderId,
      inp.msgType,
      inp.content ?? null,
      inp.audioPath ?? null,
      inp.imagePath ?? null,
      inp.duration ?? null,
      inp.toolCalls ?? null,
      inp.agentSessionId ?? null,
      inp.transcript ?? null,
      inp.meta !== undefined ? JSON.stringify(inp.meta) : null,
      now
    );

    // 更新会话 updated_at
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, inp.conversationId);

    // 对方（非 me）发来消息时，视作已读我此前发出的消息 —— 生成「已读回执」
    if (inp.senderId !== ME_ID) {
      db.prepare(
        "UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL"
      ).run(now, inp.conversationId, ME_ID);
    }
    return getMessage(id)!;
  });
  return tx(input);
}

export function getMessage(id: string): DbMessage | undefined {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessage | undefined;
}

export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls' | 'agent_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
  if (updates.tool_calls !== undefined) { fields.push('tool_calls = ?'); values.push(updates.tool_calls); }
  if (updates.agent_session_id !== undefined) { fields.push('agent_session_id = ?'); values.push(updates.agent_session_id); }
  if (fields.length === 0) return false;
  values.push(id);
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  return stmt.run(...values).changes > 0;
}

// 标记会话内所有消息为已读（打开会话时调用）
export function markConversationRead(conversationId: string): void {
  db.prepare('UPDATE messages SET read = 1 WHERE conversation_id = ? AND read = 0').run(conversationId);
}

// 统计会话未读消息数（来自他人/助手且未读，系统消息不计）
export function getUnreadCount(conversationId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND sender_id != ? AND read = 0 AND msg_type != 'system'"
  ).get(conversationId, ME_ID) as { c: number };
  return row.c;
}

// 媒体文件回收：仅当再无任何消息引用该文件名时才删除磁盘文件（避免误删被转发/共享引用的媒体）
export function maybeDeleteMediaFile(filename: string | null | undefined, kind: 'voice' | 'image'): void {
  if (!filename) return;
  const baseDir = kind === 'voice' ? UPLOADS_DIR : IMAGE_UPLOADS_DIR;
  const abs = path.resolve(baseDir, filename);
  // 安全校验：必须严格位于对应 uploads 目录内，杜绝路径穿越
  if (!abs.startsWith(baseDir + path.sep)) return;
  if (!fs.existsSync(abs)) return;
  const col = kind === 'voice' ? 'audio_path' : 'image_path';
  const refs = (db.prepare(`SELECT COUNT(*) as c FROM messages WHERE ${col} = ?`).get(filename) as { c: number }).c;
  if (refs === 0) {
    // 异步、尽力而为地删除：避免在杀软扫描并锁定文件时，unlinkSync 阻塞当前请求
    // （删除消息 API 不再被拖慢 30s+）。文件会在杀软释放锁后由线程池完成删除。
    void fs.promises.unlink(abs).catch(() => {
      /* 文件可能仍被其他进程占用，忽略 */
    });
  }
}

// 删除单条消息，并回收其独占的媒体文件
export function deleteMessage(messageId: string): boolean {
  const m = getMessage(messageId);
  const ok = db.prepare('DELETE FROM messages WHERE id = ?').run(messageId).changes > 0;
  if (ok && m) {
    maybeDeleteMediaFile(m.audio_path, 'voice');
    maybeDeleteMediaFile(m.image_path, 'image');
  }
  return ok;
}

// 清空会话全部消息（保留会话本身），并回收所有媒体文件
export function clearConversationMessages(conversationId: string): boolean {
  const media = db.prepare('SELECT audio_path, image_path FROM messages WHERE conversation_id = ?').all(conversationId) as {
    audio_path: string | null;
    image_path: string | null;
  }[];
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
  const seen = new Set<string>();
  for (const row of media) {
    if (row.audio_path && !seen.has('v:' + row.audio_path)) {
      seen.add('v:' + row.audio_path);
      maybeDeleteMediaFile(row.audio_path, 'voice');
    }
    if (row.image_path && !seen.has('i:' + row.image_path)) {
      seen.add('i:' + row.image_path);
      maybeDeleteMediaFile(row.image_path, 'image');
    }
  }
  return true;
}

export interface SearchResult {
  id: string;
  conversationId: string;
  conversationTitle: string;
  conversationType: string;
  senderId: string;
  senderName: string;
  msgType: string;
  content: string | null;
  createdAt: string;
}

// 全文搜索消息（仅 text/agent 类型），可按会话限定；返回带会话与发送者信息的富结果
export function searchMessages(query: string, conversationId?: string): SearchResult[] {
  const like = `%${query}%`;
  const params: any[] = [like];
  if (conversationId) params.push(conversationId);
  const rows = db.prepare(`
    SELECT m.id, m.conversation_id, m.sender_id, m.msg_type, m.content, m.created_at,
           c.title AS conv_title, c.type AS conv_type,
           ct.name AS sender_name
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN contacts ct ON ct.id = m.sender_id
    WHERE m.msg_type IN ('text', 'agent')
      AND m.content LIKE ?
      ${conversationId ? 'AND m.conversation_id = ?' : ''}
    ORDER BY m.created_at DESC
    LIMIT 50
  `).all(...params) as any[];
  return rows.map(r => ({
    id: r.id,
    conversationId: r.conversation_id,
    conversationTitle: r.conv_title || (r.conv_type === 'group' ? '群聊' : '会话'),
    conversationType: r.conv_type,
    senderId: r.sender_id,
    senderName: r.sender_name || (r.sender_id === ME_ID ? '我' : r.sender_id),
    msgType: r.msg_type,
    content: r.content,
    createdAt: r.created_at,
  }));
}

// 添加群成员
export function addParticipant(conversationId: string, contactId: string): void {
  db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, contact_id) VALUES (?, ?)').run(conversationId, contactId);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
}

// 移除群成员（不能移除自己，且群至少保留一名成员）
export function removeParticipant(conversationId: string, contactId: string): boolean {
  if (contactId === ME_ID) return false;
  const remaining = db.prepare('SELECT COUNT(*) as c FROM conversation_participants WHERE conversation_id = ?').get(conversationId) as { c: number };
  if (remaining.c <= 1) return false;
  const changes = db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND contact_id = ?').run(conversationId, contactId).changes;
  if (changes > 0) db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), conversationId);
  return changes > 0;
}

// 优雅关闭：释放 SQLite 连接（进程退出 / 容器停止时调用）。
export function closeDb(): void {
  try { db.close(); } catch { /* 已关闭或不可关闭，忽略 */ }
}

export default db;
