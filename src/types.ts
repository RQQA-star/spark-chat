/**
 * 类型定义 - 星火聊天（WeChat 风格 + Agent 远程协助）
 */

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface Model {
  modelId: string;
  name: string;
  description?: string;
}

export interface AgentConfig {
  systemPrompt: string;
  permissionMode: string;
  model: string;
  cwd?: string;
}

export interface Contact {
  id: string;
  name: string;
  avatarText?: string;
  avatarColor?: string;
  isAgent: boolean;
  status: string;
  agentConfig?: AgentConfig | null;
}

export interface LastMessage {
  content: string;
  msgType: string;
  senderId: string;
  createdAt: string;
  meta?: { forwardedFromName?: string; mentions?: string[]; quote?: QuoteRef } | null;
}

export interface QuoteRef {
  messageId: string;
  senderName: string;
  preview: string;
  msgType?: string;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title?: string;
  avatarText?: string;
  avatarColor?: string;
  isRemoteAssist: boolean;
  remoteAssistActive: boolean;
  participantIds: string[];
  lastMessage?: LastMessage | null;
  messageCount: number;
  unreadCount?: number;
  pinned?: boolean;
  muted?: boolean;
}

export type MsgType = 'text' | 'voice' | 'system' | 'agent' | 'image' | 'file' | 'merged';

export interface ToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

export interface ConvMessage {
  id: string;
  conversationId: string;
  senderId: string;        // 'me' 或 contact.id
  msgType: MsgType;
  content?: string | null;
  transcript?: string | null;
  audioPath?: string | null;
  imagePath?: string | null;
  duration?: number | null;
  readAt?: string | null;
  toolCalls?: ToolCall[] | null;
  agentSessionId?: string | null;
  meta?: { forwardedFromName?: string; mentions?: string[]; quote?: QuoteRef } | null;
  createdAt: string;
  /** 前端临时状态 */
  isStreaming?: boolean;
  /** 发送状态：乐观插入时为 sending，服务端落库后为 sent，失败为 failed（仅我发出的消息） */
  status?: 'sending' | 'sent' | 'failed';
  /** 失败原因（status === 'failed' 时） */
  failReason?: string;
  /** 撤回（软标记，前端渲染为系统提示） */
  recalled?: boolean;
  recalledAt?: string | null;
  /** 编辑标记 */
  edited?: boolean;
  /** 表情 reaction：{ emoji: userId[] } */
  reactions?: Record<string, string[]> | null;
  /** 文件消息 */
  fileName?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
  /** 文件存储文件名（服务端生成的 uuid 名，用于下载） */
  filePath?: string | null;
}

export interface PermissionRequest {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  conversationId: string;
  timestamp: number;
}

export type Theme = 'light' | 'dark';
