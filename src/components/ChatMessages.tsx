import { useEffect, useRef, Fragment } from 'react';
import { Loading } from 'tdesign-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { Bot, User, Trash2, Forward, Reply, RefreshCw } from 'lucide-react';
import { ConvMessage, Contact, PermissionRequest } from '../types';
import { ToolCallsCollapse } from './ToolCallsCollapse';
import { InlinePermissionCard } from './InlinePermissionCard';
import { VoiceMessage } from './VoiceMessage';

interface ChatMessagesProps {
  messages: ConvMessage[];
  contacts: Contact[];
  meId: string;
  isGroup: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  permissionRequest?: PermissionRequest | null;
  onPermissionAllow?: () => void;
  onPermissionDeny?: (message?: string) => void;
  onDeleteMessage?: (id: string) => void;
  onForward?: (id: string) => void;
  onReply?: (id: string) => void;
  onRetry?: (id: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
}

function fmtClock(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, now)) return '今天';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// 将文本中被 @ 的成员名渲染为高亮（依据消息 meta.mentions）
function renderText(content: string, msg: ConvMessage, contacts: Contact[]): React.ReactNode {
  const mentionIds: string[] = msg.meta?.mentions || [];
  const nameById: Record<string, string> = {};
  contacts.forEach(c => { nameById[c.id] = c.name; });
  const mentionNames = new Set(mentionIds.map(id => nameById[id]).filter(Boolean));
  if (mentionNames.size === 0) return content;
  const parts: React.ReactNode[] = [];
  const regex = /@([^\s@]+)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const name = m[1];
    if (mentionNames.has(name)) {
      if (m.index > last) parts.push(content.slice(last, m.index));
      parts.push(<span key={m.index} style={{ color: '#0052d9', fontWeight: 600 }}>@{name}</span>);
      last = m.index + m[0].length;
    }
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}

export function ChatMessages({
  messages, contacts, meId, isGroup, messagesEndRef,   permissionRequest, onPermissionAllow, onPermissionDeny, onDeleteMessage, onForward, onReply, onRetry, scrollRef,
}: ChatMessagesProps) {
  const getContact = (id: string): Contact | undefined => contacts.find(c => c.id === id);

  useEffect(() => {
    const container = scrollRef?.current;
    if (container) {
      // 仅当用户已靠近底部时才自动滚到底部；在顶部加载历史时保持原位
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
      if (nearBottom) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, messagesEndRef, scrollRef]);

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full">
      {messages.map((msg, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const showDivider = !prev || !isSameDay(prev.createdAt, msg.createdAt);
        const divider = showDivider ? (
          <div key={`d-${msg.id}`} className="flex justify-center my-1">
            <span className="text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
              {fmtDate(msg.createdAt)}
            </span>
          </div>
        ) : null;

        if (msg.msgType === 'system') {
          return (
            <Fragment key={msg.id}>
              {divider}
              <div className="flex justify-center">
                <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
                  {msg.content}
                </span>
              </div>
            </Fragment>
          );
        }

        const isMe = msg.senderId === meId;
        const contact = getContact(msg.senderId);
        const name = isMe ? '我' : (contact?.name || '未知');
        const avatarText = isMe ? '我' : (contact?.avatarText || '?');
        const avatarColor = isMe ? '#07c160' : (contact?.avatarColor || '#888');

        const bubbleStyle = isMe
          ? { backgroundColor: '#07c160', color: '#fff', borderRadius: '14px 14px 4px 14px', opacity: msg.status === 'failed' ? 0.6 : 1 }
          : { backgroundColor: 'var(--td-bg-color-container)', color: 'var(--td-text-color-primary)', borderRadius: '14px 14px 14px 4px', opacity: msg.status === 'failed' ? 0.6 : 1 };

        return (
          <Fragment key={msg.id}>
            {divider}
            <div id={`msg-${msg.id}`} className={`group flex gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}>
              {/* 头像 */}
              <div
                className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
                style={{ backgroundColor: avatarColor, fontSize: 14 }}
              >
                {isMe ? <User size={16} /> : (contact?.isAgent ? <Bot size={16} /> : avatarText)}
              </div>

              <div className={`flex flex-col gap-1 max-w-[78%] ${isMe ? 'items-end' : 'items-start'}`}>
                {isGroup && !isMe && (
                  <span className="text-xs px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>{name}</span>
                )}

                {/* 转发来源徽标 */}
                {msg.meta?.forwardedFromName && (
                  <span className="text-[11px] px-1 flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    <Forward size={11} /> 转发自 {msg.meta.forwardedFromName}
                  </span>
                )}

                {/* 引用回复块 */}
                {msg.meta?.quote && (
                  <div
                    onClick={() => document.getElementById(`msg-${msg.meta!.quote!.messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className="max-w-full px-2.5 py-1.5 rounded-lg cursor-pointer text-xs mb-1"
                    style={{ backgroundColor: 'var(--td-bg-color-component)', borderLeft: '3px solid #07c160' }}
                  >
                    <div className="font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>{msg.meta.quote.senderName}</div>
                    <div className="truncate" style={{ color: 'var(--td-text-color-placeholder)' }}>{msg.meta.quote.preview}</div>
                  </div>
                )}

                {/* 文本 */}
                {msg.msgType === 'text' && (
                  <div className="px-3.5 py-2.5 leading-relaxed break-words text-[15px] whitespace-pre-wrap" style={bubbleStyle}>
                    {renderText(msg.content || '', msg, contacts)}
                  </div>
                )}

                {/* 语音 */}
                {msg.msgType === 'voice' && msg.audioPath && (
                  <div className="px-1 py-1" style={{ ...bubbleStyle, background: isMe ? '#07c160' : 'var(--td-bg-color-container)' }}>
                    <div style={{ color: isMe ? '#fff' : 'var(--td-text-color-primary)' }}>
                      <VoiceMessage audioPath={msg.audioPath} duration={msg.duration} transcript={msg.transcript} />
                    </div>
                  </div>
                )}

                {/* 图片 */}
                {msg.msgType === 'image' && msg.imagePath && (
                  <div className="px-1 py-1" style={{ ...bubbleStyle, background: isMe ? '#07c160' : 'var(--td-bg-color-container)' }}>
                    <img
                      src={`/api/image/${msg.imagePath}`}
                      alt="图片"
                      className="max-w-[220px] max-h-[260px] rounded-lg object-cover cursor-pointer"
                      onClick={() => window.open(`/api/image/${msg.imagePath}`, '_blank')}
                    />
                  </div>
                )}

                {/* Agent 消息（含工具调用） */}
                {msg.msgType === 'agent' && (
                  <div className="flex flex-col gap-2" style={{ ...bubbleStyle, maxWidth: '100%' }}>
                    {msg.content ? (
                      <div className="px-3.5 py-2.5 leading-relaxed break-words text-[15px] chat-markdown" style={{ color: 'var(--td-text-color-primary)' }}>
                        <ChatMarkdown content={msg.content} />
                      </div>
                    ) : msg.isStreaming ? (
                      <div className="px-3.5 py-2.5 flex items-center gap-2" style={{ color: 'var(--td-text-color-secondary)' }}>
                        <Loading size="small" /> 思考中…
                      </div>
                    ) : null}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="px-3 pb-2">
                        <ToolCallsCollapse toolCalls={msg.toolCalls} isStreaming={msg.isStreaming} />
                      </div>
                    )}
                  </div>
                )}

                <span className="text-[11px] px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>{fmtClock(msg.createdAt)}</span>
                {isMe && (msg.msgType === 'text' || msg.msgType === 'voice' || msg.msgType === 'image') && (
                  msg.status === 'sending' ? (
                    <span className="text-[11px] px-1 inline-flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                      <Loading size="small" /> 发送中…
                    </span>
                  ) : msg.status === 'failed' ? (
                    <span className="text-[11px] px-1 inline-flex items-center gap-1.5">
                      <span style={{ color: '#e34d59' }}>发送失败</span>
                      {onRetry && (
                        <button
                          onClick={() => onRetry(msg.id)}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:opacity-80"
                          style={{ color: '#fff', backgroundColor: '#e34d59' }}
                          title="点击重试"
                        >
                          <RefreshCw size={11} /> 重试
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="text-[11px] px-1" style={{ color: msg.readAt ? '#07c160' : 'var(--td-text-color-placeholder)' }}>
                      {msg.readAt ? '已读' : '已送达'}
                    </span>
                  )
                )}
                {msg.meta?.mentions?.includes(meId) && (
                  <span className="text-[11px] px-1 rounded" style={{ color: '#fff', backgroundColor: '#e34d59' }}>@我</span>
                )}
              </div>

              {/* hover 操作：回复 / 转发 / 删除 */}
              {onReply && (
                <button
                  onClick={() => onReply(msg.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity self-center p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]"
                  style={{ color: 'var(--td-text-color-placeholder)' }}
                  title="回复消息"
                >
                  <Reply size={15} />
                </button>
              )}
              {onForward && (
                <button
                  onClick={() => onForward(msg.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity self-center p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]"
                  style={{ color: 'var(--td-text-color-placeholder)' }}
                  title="转发消息"
                >
                  <Forward size={15} />
                </button>
              )}
              {onDeleteMessage && (
                <button
                  onClick={() => onDeleteMessage(msg.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity self-center p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]"
                  style={{ color: 'var(--td-text-color-placeholder)' }}
                  title="删除消息"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </Fragment>
        );
      })}

      {/* 内联权限确认 */}
      {permissionRequest && onPermissionAllow && onPermissionDeny && (
        <div className="ml-12">
          <InlinePermissionCard request={permissionRequest} onAllow={onPermissionAllow} onDeny={onPermissionDeny} />
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
