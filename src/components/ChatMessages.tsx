import { useEffect, useRef, useState, Fragment } from 'react';
import { Loading } from 'tdesign-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { Bot, User, Trash2, Forward, Reply, RefreshCw, Copy, Smile, Check, CheckCheck, MoreVertical, File as FileIcon, Pencil, Star, MapPin, Link2, Video, IdCard } from 'lucide-react';
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
  onEdit?: (id: string, content: string) => void;
  onRecall?: (id: string) => void;
  onToggleReaction?: (id: string, emoji: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement>;
  // 大图灯箱 / 个人名片页
  onPreviewImage?: (imagePath: string) => void;
  onPreviewContact?: (contactId: string) => void;
  /** 双击头像拍一拍 */
  onPat?: (targetId: string) => void;
  /** 撤回后重新编辑（仅本人文本消息、撤回 2 分钟内） */
  onReedit?: (content: string) => void;
  /** 已播放的语音消息 id 集合（用于未读红点） */
  playedVoice?: Set<string>;
  /** 语音开始播放时回调（标记已读） */
  onVoicePlayed?: (id: string) => void;
  // 收藏
  onFavorite?: (id: string) => void;
  // 多选模式
  multiSelect?: boolean;
  selection?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onEnterMultiSelect?: (id: string) => void;
  // 初次加载当前会话消息时显示骨架屏（仅当列表为空时生效）
  loading?: boolean;
  // 搜索结果跳转：定位并高亮某条消息（来自 SearchModal 的 onSelect）
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
  // 命中消息尚在更早历史时，尝试向上加载更多再定位
  onLoadOlderMessages?: () => Promise<void>;
  hasMoreMessages?: boolean;
}

function fmtClock(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, now)) return time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return `昨天 ${time}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
function fmtSize(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function previewOf(m: ConvMessage): string {
  if (m.recalled) return '撤回了一条消息';
  if (m.msgType === 'voice') return '[语音]';
  if (m.msgType === 'image') return '[图片]';
  if (m.msgType === 'file') return `[文件] ${m.fileName || ''}`;
  if (m.msgType === 'video') return '[视频]';
  if (m.msgType === 'sticker') return '[表情]';
  if (m.msgType === 'link') return `[链接] ${m.meta?.link?.title || m.content || ''}`;
  if (m.msgType === 'location') return `[位置] ${m.meta?.location?.name || m.meta?.location?.address || ''}`;
  if (m.msgType === 'card') return `[名片] ${m.meta?.card?.cardName || m.content || ''}`;
  if (m.msgType === 'merged') return '[聊天记录]';
  return (m.content || '').slice(0, 80);
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😍', '🎉', '😢'];

// 微信式气泡圆角：统一 8px 基础圆角 + 头像侧 2px 小尾巴，文本/媒体气泡一致对齐
const BUBBLE_RADIUS_ME = '8px 8px 2px 8px';
const BUBBLE_RADIUS_OTHER = '8px 8px 8px 2px';
const bubbleRadius = (isMe: boolean) => (isMe ? BUBBLE_RADIUS_ME : BUBBLE_RADIUS_OTHER);

// 图片气泡：加载失败时回退为占位块，避免「裂图」破坏对称布局
function ImageBubble({ imagePath, onPreview, radius }: { imagePath: string; onPreview?: (imagePath: string) => void; radius?: string }) {
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (err) {
    return (
      <div className="flex items-center justify-center w-[240px] h-[180px]" style={{ borderRadius: radius || '8px', backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
        <span className="text-xs">图片加载失败</span>
      </div>
    );
  }
  return (
    <div
      className="relative overflow-hidden cursor-pointer"
      style={{ border: '1px solid var(--td-component-stroke)', maxWidth: 260, borderRadius: radius || '8px' }}
      onClick={() => onPreview ? onPreview(imagePath) : window.open(`/api/image/${imagePath}`, '_blank')}
    >
      {!loaded && (
        <div className="absolute inset-0 animate-pulse" style={{ backgroundColor: 'var(--td-bg-color-component)' }} />
      )}
      <img
        src={`/api/image/${imagePath}`}
        alt="图片"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErr(true)}
        className="block max-w-[260px] max-h-[320px] object-contain"
        style={{ borderRadius: radius || '8px' }}
      />
    </div>
  );
}

// 文件卡片
function FileBubble({ msg, isMe, radius }: { msg: ConvMessage; isMe: boolean; radius?: string }) {
  const ext = (msg.fileName || '').split('.').pop()?.toUpperCase() || 'FILE';
  return (
    <a
      href={`/api/file/${msg.filePath || msg.fileName}`}
      download={msg.fileName || 'file'}
      className="flex items-center gap-3 px-3 py-2.5 min-w-[220px] max-w-[280px] no-underline"
      style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-component)', color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)', borderRadius: radius || '8px' }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-icon-bg)' : '#0052d9', color: '#fff' }}>
        <FileIcon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate font-medium">{msg.fileName}</div>
        <div className="text-[11px] opacity-70">{ext} · {fmtSize(msg.fileSize)}</div>
      </div>
    </a>
  );
}

// 合并转发（聊天记录）卡片
function MergedBubble({ msg, isMe, radius }: { msg: ConvMessage; isMe: boolean; radius?: string }) {
  let data: { title?: string; items?: { senderName: string; time: string; preview: string }[] } | null = null;
  try { data = JSON.parse(msg.content || '{}'); } catch { data = null; }
  const items = data?.items || [];
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 4);
  return (
    <div
      className="overflow-hidden min-w-[240px] max-w-[300px] cursor-pointer"
      style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-container)', color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)', borderRadius: radius || '8px' }}
      onClick={() => setExpanded(v => !v)}
    >
      <div className="px-3 py-2 font-medium text-sm border-b" style={{ borderColor: isMe ? 'var(--spark-own-bubble-icon-bg)' : 'var(--td-component-stroke)' }}>
        {data?.title || '聊天记录'}
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        {shown.map((it, i) => (
          <div key={i} className="text-xs leading-snug">
            <span style={{ color: isMe ? 'var(--spark-own-bubble-text)' : '#0052d9', fontWeight: 600 }}>{it.senderName}</span>
            <span className="opacity-60 mx-1">{it.time}</span>
            <span className="opacity-80">{it.preview}</span>
          </div>
        ))}
        {!expanded && items.length > 4 && <div className="text-xs opacity-60">…等 {items.length} 条记录</div>}
        {expanded && items.length > 4 && <div className="text-xs opacity-60">点击收起</div>}
      </div>
    </div>
  );
}

// 大表情（贴纸）：无气泡背景，大号展示
function StickerBubble({ content }: { content: string }) {
  return (
    <div
      className="text-[64px] leading-none select-none max-w-[min(72vw,360px)] break-words"
      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.18))' }}
    >
      {content}
    </div>
  );
}

// 链接卡片
function LinkBubble({ msg, isMe, radius }: { msg: ConvMessage; isMe: boolean; radius?: string }) {
  const link = msg.meta?.link;
  const url = link?.url || msg.content || '';
  let host = '';
  try { host = new URL(url).host; } catch { host = url; }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-3 py-2.5 min-w-[240px] max-w-[300px] no-underline"
      style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-component)', color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)', borderRadius: radius || '8px' }}
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-icon-bg)' : '#0052d9', color: '#fff' }}>
        <Link2 size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate font-medium">{link?.title || host}</div>
        <div className="text-[11px] opacity-70 truncate">{link?.description || url}</div>
      </div>
    </a>
  );
}

// 视频消息
function VideoBubble({ videoPath, radius }: { videoPath: string; radius?: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="flex items-center justify-center w-[240px] h-[160px]" style={{ borderRadius: radius || '8px', backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
        <span className="text-xs">视频加载失败</span>
      </div>
    );
  }
  return (
    <video
      src={`/api/video/${videoPath}`}
      controls
      preload="metadata"
      onError={() => setErr(true)}
      className="max-w-[240px] max-h-[320px] bg-black"
      style={{ borderRadius: radius || '8px' }}
    />
  );
}

// 位置消息
function LocationBubble({ msg, isMe, onOpen, radius }: { msg: ConvMessage; isMe: boolean; onOpen?: () => void; radius?: string }) {
  const loc = msg.meta?.location;
  const name = loc?.name || '位置';
  const address = loc?.address || (loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : '');
  const mapsUrl = loc ? `https://uri.amap.com/marker?position=${loc.lng},${loc.lat}&name=${encodeURIComponent(name)}` : '';
  return (
    <div
      className="overflow-hidden min-w-[240px] max-w-[300px] cursor-pointer"
      style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-container)', color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)', borderRadius: radius || '8px' }}
      onClick={onOpen}
    >
      <div
        className="h-24 flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg,#e8f3ff,#d6e9ff)' }}
      >
        <MapPin size={32} style={{ color: '#0052d9' }} />
      </div>
      <div className="px-3 py-2">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-[11px] opacity-70 truncate mt-0.5">{address}</div>
      </div>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-center text-[12px] py-1.5 border-t"
          style={{ borderColor: isMe ? 'var(--spark-own-bubble-icon-bg)' : 'var(--td-component-stroke)', color: '#0052d9' }}
          onClick={(e) => e.stopPropagation()}
        >
          在地图中打开
        </a>
      )}
    </div>
  );
}

// 名片消息（分享联系人）
function CardBubble({ msg, isMe, onPreviewContact, radius }: { msg: ConvMessage; isMe: boolean; onPreviewContact?: (id: string) => void; radius?: string }) {
  const card = msg.meta?.card;
  if (!card) return null;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 min-w-[220px] max-w-[280px] cursor-pointer"
      style={{ backgroundColor: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-container)', color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)', borderRadius: radius || '8px' }}
      onClick={() => onPreviewContact?.(card.cardId)}
    >
      <div className="w-11 h-11 rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0" style={{ backgroundColor: card.cardAvatarColor || '#888', fontSize: 16 }}>
        {card.cardIsAgent ? <Bot size={18} /> : (card.cardAvatarText || card.cardName.slice(0, 1))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{card.cardName}</span>
          <IdCard size={14} className="opacity-60 flex-shrink-0" />
        </div>
        <div className="text-[11px] opacity-70">{card.cardIsAgent ? '星火助手' : '个人名片'}</div>
      </div>
    </div>
  );
}

function Reactions({ msg, meId, onToggle }: { msg: ConvMessage; meId: string; onToggle: (e: string) => void }) {
  const map = msg.reactions || {};
  const entries = Object.entries(map).filter(([, ids]) => (ids as string[]).length > 0);
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([emoji, ids]) => {
        const arr = ids as string[];
        const mine = arr.includes(meId);
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
            className="px-1.5 py-0.5 rounded-full text-xs flex items-center gap-0.5 border"
            style={{
              borderColor: mine ? '#07c160' : 'var(--td-component-stroke)',
              backgroundColor: mine ? 'rgba(7,193,96,0.12)' : 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
            }}
          >
            <span>{emoji}</span>
            <span className="opacity-70">{arr.length}</span>
          </button>
        );
      })}
    </div>
  );
}

// 初始加载当前会话消息时的骨架屏：模拟若干条左右交替的聊天气泡，配合 shimmer 动画
function MessageSkeleton() {
  const rows = [false, true, false, false, true, false, true, false];
  return (
    <div className="flex flex-col gap-4 w-full">
      {rows.map((me, i) => (
        <div key={i} className={`flex gap-3 ${me ? 'flex-row-reverse' : ''}`}>
          <div className="w-9 h-9 rounded-full bg-[var(--td-bg-color-component)] animate-pulse flex-shrink-0" />
          <div className={`flex flex-col gap-1.5 max-w-[70%] ${me ? 'items-end' : 'items-start'}`}>
            <div
              className="h-10 rounded-[14px] bg-[var(--td-bg-color-component)] animate-pulse"
              style={{ width: i % 3 === 0 ? 200 : i % 3 === 1 ? 120 : 260 }}
            />
            <div className="h-3 w-12 rounded bg-[var(--td-bg-color-component)] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatMessages({
  messages, contacts, meId, isGroup, messagesEndRef,
  permissionRequest, onPermissionAllow, onPermissionDeny, onDeleteMessage, onForward, onReply, onRetry, onEdit, onRecall, onToggleReaction, onPat, scrollRef,
  focusMessageId, onFocusHandled, onLoadOlderMessages, hasMoreMessages,
  onPreviewImage, onPreviewContact, onFavorite, onReedit, playedVoice, onVoicePlayed,
  multiSelect = false, selection = new Set<string>(), onToggleSelect = () => {}, onEnterMultiSelect = () => {},
  loading = false,
}: ChatMessagesProps) {
  const getContact = (id: string): Contact | undefined => contacts.find(c => c.id === id);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const longPressRef = useRef<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusAttemptRef = useRef(0);

  useEffect(() => {
    // 搜索跳转定位期间不强制粘底，避免与跳转滚动打架
    if (focusMessageId) return;
    const container = scrollRef?.current;
    if (container) {
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
      if (nearBottom) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, messagesEndRef, scrollRef, focusMessageId]);

  // 搜索结果跳转：滚动到命中消息并短暂高亮；若消息尚在更早历史则分批向上加载更多再定位（上限 8 批）
  useEffect(() => {
    if (!focusMessageId) { focusAttemptRef.current = 0; return; }
    const el = typeof document !== 'undefined' ? document.getElementById(`msg-${focusMessageId}`) : null;
    if (el) {
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setHighlightId(focusMessageId);
      focusAttemptRef.current = 0;
      onFocusHandled?.();
      const t = window.setTimeout(() => setHighlightId(null), 1600);
      return () => window.clearTimeout(t);
    }
    if (hasMoreMessages && onLoadOlderMessages && focusAttemptRef.current < 8) {
      focusAttemptRef.current += 1;
      onLoadOlderMessages();
      return;
    }
    // 已无更早消息或尝试达上限仍找不到，放弃定位并复位
    onFocusHandled?.();
  }, [focusMessageId, messages, hasMoreMessages, onLoadOlderMessages, onFocusHandled]);

  const canRecall = (msg: ConvMessage) => {
    if (msg.senderId !== meId || msg.recalled) return false;
    if (msg.msgType === 'system' || msg.msgType === 'agent') return false;
    return Date.now() - new Date(msg.createdAt).getTime() < 2 * 60 * 1000;
  };
  const canEdit = (msg: ConvMessage) => msg.senderId === meId && msg.msgType === 'text' && !msg.recalled;

  const openMenu = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    e.preventDefault();
    const pt = 'clientX' in e ? e : { clientX: (e as React.TouchEvent).touches[0].clientX, clientY: (e as React.TouchEvent).touches[0].clientY };
    setMenu({ id, x: pt.clientX, y: pt.clientY });
  };

  const copyText = (msg: ConvMessage) => {
    const text = msg.msgType === 'text' ? (msg.content || '') : previewOf(msg);
    navigator.clipboard?.writeText(text).catch(() => {});
    setMenu(null);
  };

  const startEdit = (msg: ConvMessage) => {
    setEditingId(msg.id);
    setEditText(msg.content || '');
    setMenu(null);
  };
  const commitEdit = (id: string) => {
    if (onEdit && editText.trim()) onEdit(id, editText.trim());
    setEditingId(null);
  };

  const menuItems = (msg: ConvMessage) => {
    const items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] = [];
    if (onReply) items.push({ label: '回复', icon: <Reply size={14} />, onClick: () => { onReply(msg.id); setMenu(null); } });
    if (onForward) items.push({ label: '转发', icon: <Forward size={14} />, onClick: () => { onForward(msg.id); setMenu(null); } });
    if (msg.msgType === 'text') items.push({ label: '复制', icon: <Copy size={14} />, onClick: () => copyText(msg) });
    if (canEdit(msg)) items.push({ label: '编辑', icon: <Pencil size={14} />, onClick: () => startEdit(msg) });
    if (canRecall(msg) && onRecall) items.push({ label: '撤回', icon: <Reply size={14} style={{ transform: 'scaleX(-1)' }} />, onClick: () => { onRecall(msg.id); setMenu(null); } });
    items.push({ label: '多选', icon: <Check size={14} />, onClick: () => { onEnterMultiSelect(msg.id); setMenu(null); } });
    if (onFavorite && !msg.recalled) items.push({ label: '收藏', icon: <Star size={14} />, onClick: () => { onFavorite(msg.id); setMenu(null); } });
    if (onDeleteMessage) items.push({ label: '删除', icon: <Trash2 size={14} />, onClick: () => { onDeleteMessage(msg.id); setMenu(null); }, danger: true });
    return items;
  };

  return (
    <div className="flex flex-col gap-3 max-w-3xl mx-auto w-full" style={{ fontSize: 'calc(15px * var(--spark-font-scale, 1))' }} onClick={() => { setMenu(null); setReactionFor(null); }}>
      {loading && messages.length === 0 ? (
        <MessageSkeleton />
      ) : (
      messages.map((msg, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        // 微信式时间分割：首条 / 跨天 / 与上一条间隔超 5 分钟 时显示时间戳
        const gapMs = prev ? new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity;
        const showDivider = !prev || !isSameDay(prev.createdAt, msg.createdAt) || gapMs > 5 * 60 * 1000;
        const divider = showDivider ? (
          <div key={`d-${msg.id}`} data-testid="time-divider" className="flex justify-center my-1">
            <span className="text-[11px] px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
              {fmtDate(msg.createdAt)}
            </span>
          </div>
        ) : null;

        // 撤回：渲染为系统提示；本人文本消息 2 分钟内可「重新编辑」
        if (msg.recalled) {
          const who = msg.senderId === meId ? '你' : (getContact(msg.senderId)?.name || '对方');
          const canReedit = msg.senderId === meId && msg.msgType === 'text' && !!msg.content
            && !!msg.recalledAt && Date.now() - new Date(msg.recalledAt).getTime() < 2 * 60 * 1000;
          return (
            <Fragment key={msg.id}>
              {divider}
              <div className="flex justify-center items-center gap-2">
                <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
                  {who} 撤回了一条消息
                </span>
                {canReedit && (
                  <button type="button" onClick={() => onReedit?.(msg.content || '')} className="text-xs font-medium" style={{ color: '#07c160' }}>
                    重新编辑
                  </button>
                )}
              </div>
            </Fragment>
          );
        }

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

        if (msg.msgType === 'pat') {
          const pattedId = msg.meta?.pattedId;
          const patterName = msg.senderId === meId ? '你' : (getContact(msg.senderId)?.name || '对方');
          const pattedName = pattedId === meId ? '我' : (getContact(pattedId || '')?.name || '对方');
          return (
            <Fragment key={msg.id}>
              {divider}
              <div className="flex justify-center">
                <span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
                  {patterName} 拍了拍 {pattedName}
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
        const selected = multiSelect && selection.has(msg.id);

        const bubbleStyle = isMe
          ? { backgroundColor: 'var(--spark-own-bubble-bg)', color: 'var(--spark-own-bubble-text)', borderRadius: BUBBLE_RADIUS_ME, opacity: msg.status === 'failed' ? 0.6 : 1 }
          : { backgroundColor: 'var(--td-bg-color-container)', color: 'var(--td-text-color-primary)', borderRadius: BUBBLE_RADIUS_OTHER, opacity: msg.status === 'failed' ? 0.6 : 1 };

        const onBubbleClick = () => {
          if (multiSelect) { onToggleSelect(msg.id); return; }
        };

        return (
          <Fragment key={msg.id}>
            {divider}
            <div
              id={`msg-${msg.id}`}
              className={`group flex gap-3 ${isMe ? 'flex-row-reverse' : ''} ${selected ? 'rounded-xl px-1' : ''} ${highlightId === msg.id ? 'msg-flash' : ''}`}
              style={selected ? { backgroundColor: 'rgba(7,193,96,0.12)' } : undefined}
              onContextMenu={(e) => openMenu(e, msg.id)}
              onTouchStart={() => { longPressRef.current = window.setTimeout(() => openMenu({ clientX: 0, clientY: 0 } as any, msg.id), 500); }}
              onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
            >
              {/* 头像 / 多选勾选 */}
              {multiSelect ? (
                <button
                  onClick={() => onToggleSelect(msg.id)}
                  className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border-2 mt-0.5"
                  style={{ borderColor: selected ? '#07c160' : 'var(--td-component-stroke)', backgroundColor: selected ? '#07c160' : 'transparent', color: '#fff' }}
                >
                  {selected && <Check size={16} />}
                </button>
              ) : (
                <div
                  data-testid="msg-avatar"
                  className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center font-semibold text-white cursor-pointer"
                  style={{ backgroundColor: avatarColor, fontSize: 14 }}
                  title="双击拍一拍"
                  onClick={() => { if (!isMe && onPreviewContact) onPreviewContact(msg.senderId); }}
                  onDoubleClick={() => { if (!multiSelect && onPat) onPat(msg.senderId); }}
                >
                  {isMe ? <User size={16} /> : (contact?.isAgent ? <Bot size={16} /> : avatarText)}
                </div>
              )}

              <div className={`flex flex-col gap-1 max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                {isGroup && !isMe && !multiSelect && (
                  <span className="text-xs px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>{name}</span>
                )}

                {msg.meta?.forwardedFromName && (
                  <span className="text-[11px] px-1 flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    <Forward size={11} /> 转发自 {msg.meta.forwardedFromName}
                  </span>
                )}

                {msg.meta?.mentions?.includes('all') && isGroup && (
                  <span data-testid="at-all-badge" className="text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1" style={{ color: '#fff', backgroundColor: '#e34d59' }}>
                    @ 所有人
                  </span>
                )}

                {msg.meta?.quote && (
                  <div
                    onClick={() => document.getElementById(`msg-${msg.meta!.quote!.messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    data-testid="quote-block"
                    className="max-w-full px-2.5 py-1.5 cursor-pointer text-xs mb-1.5"
                    style={{
                      // 微信式引用：内嵌于气泡之上的半透明色带，本人绿底用透白、对方白底用浅灰
                      backgroundColor: isMe ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.045)',
                      borderRadius: '6px',
                      borderLeft: `2px solid ${isMe ? 'rgba(255,255,255,0.6)' : '#07c160'}`,
                    }}
                  >
                    <div className="font-medium truncate" style={{ color: isMe ? 'rgba(255,255,255,0.95)' : 'var(--td-text-color-secondary)' }}>{msg.meta.quote.senderName}</div>
                    <div className="truncate" style={{ color: isMe ? 'rgba(255,255,255,0.72)' : 'var(--td-text-color-placeholder)' }}>{msg.meta.quote.preview}</div>
                  </div>
                )}

                {/* 编辑态 */}
                {editingId === msg.id ? (
                  <div className="flex flex-col gap-1 w-full" style={bubbleStyle}>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                      rows={2}
                      className="w-full bg-transparent outline-none resize-none px-3 py-2 text-[15px]"
                      style={{ color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)' }}
                    />
                    <div className="flex justify-end gap-2 px-2 pb-2">
                      <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 rounded" style={{ color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-secondary)' }}>取消</button>
                      <button onClick={() => commitEdit(msg.id)} className="text-xs px-2 py-1 rounded" style={{ color: '#fff', backgroundColor: '#07c160' }}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.msgType === 'text' && (
                      <div className="px-3.5 py-2.5 leading-relaxed break-words text-[1em] whitespace-pre-wrap" style={bubbleStyle} onClick={onBubbleClick}>
                        {renderText(msg.content || '', msg, contacts)}
                        {msg.edited && <span className="text-[10px] opacity-60 ml-1">(已编辑)</span>}
                      </div>
                    )}

                    {msg.msgType === 'voice' && msg.audioPath && (
                      <div className="relative" style={{ ...bubbleStyle, background: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-container)' }} onClick={onBubbleClick}>
                        {/* 收到的语音未播放时显示未读红点（微信式） */}
                        {msg.senderId !== meId && !playedVoice?.has(msg.id) && (
                          <span data-testid="voice-unread" className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#fa5151' }} />
                        )}
                        <div style={{ color: isMe ? 'var(--spark-own-bubble-text)' : 'var(--td-text-color-primary)' }}>
                          <VoiceMessage audioPath={msg.audioPath} duration={msg.duration} transcript={msg.transcript} onPlayed={() => onVoicePlayed?.(msg.id)} />
                        </div>
                      </div>
                    )}

                    {msg.msgType === 'image' && msg.imagePath && (
                      <div className="px-1 py-1" style={{ ...bubbleStyle, background: isMe ? 'var(--spark-own-bubble-bg)' : 'var(--td-bg-color-container)' }} onClick={onBubbleClick}>
                        <ImageBubble imagePath={msg.imagePath} onPreview={onPreviewImage} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'file' && (
                      <div onClick={onBubbleClick}>
                        <FileBubble msg={msg} isMe={isMe} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'merged' && (
                      <div onClick={onBubbleClick}>
                        <MergedBubble msg={msg} isMe={isMe} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'sticker' && (
                      <div onClick={onBubbleClick}>
                        <StickerBubble content={msg.content || ''} />
                      </div>
                    )}

                    {msg.msgType === 'link' && (
                      <div onClick={onBubbleClick}>
                        <LinkBubble msg={msg} isMe={isMe} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'video' && msg.videoPath && (
                      <div onClick={onBubbleClick}>
                        <VideoBubble videoPath={msg.videoPath} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'location' && (
                      <div onClick={onBubbleClick}>
                        <LocationBubble msg={msg} isMe={isMe} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'card' && (
                      <div onClick={onBubbleClick}>
                        <CardBubble msg={msg} isMe={isMe} onPreviewContact={onPreviewContact} radius={bubbleRadius(isMe)} />
                      </div>
                    )}

                    {msg.msgType === 'agent' && (
                      <div className="flex flex-col gap-2" style={{ ...bubbleStyle, maxWidth: '100%' }}>
                        {msg.content ? (
                          <div className="px-3.5 py-2.5 leading-relaxed break-words text-[1em] chat-markdown" style={{ color: 'var(--td-text-color-primary)' }}>
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
                  </>
                )}

                {/* 时间 / 状态 / reaction */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span data-testid="msg-clock" className="text-[11px]" style={{ color: 'var(--td-text-color-placeholder)' }}>{fmtClock(msg.createdAt)}</span>
                  {isMe && (msg.msgType === 'text' || msg.msgType === 'voice' || msg.msgType === 'image' || msg.msgType === 'file') && (
                    msg.status === 'sending' ? (
                      <span className="text-[11px] px-1 inline-flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                        <Loading size="small" /> 发送中…
                      </span>
                    ) : msg.status === 'failed' ? (
                      <span className="text-[11px] px-1 inline-flex items-center gap-1.5">
                        <span style={{ color: '#e34d59' }}>发送失败</span>
                        {onRetry && (
                          <button onClick={() => onRetry(msg.id)} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:opacity-80" style={{ color: '#fff', backgroundColor: '#e34d59' }} title="点击重试">
                            <RefreshCw size={11} /> 重试
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="text-[11px] px-1 inline-flex items-center" style={{ color: msg.readAt ? '#07c160' : 'var(--td-text-color-placeholder)' }}>
                        {msg.readAt ? <CheckCheck size={14} aria-label="已读" /> : <Check size={14} aria-label="已送达" />}
                      </span>
                    )
                  )}
                  {msg.meta?.mentions?.includes(meId) && (
                    <span data-testid="at-me-badge" className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: '#fff', backgroundColor: '#e34d59' }}>@我</span>
                  )}
                </div>

                {onToggleReaction && (msg.msgType === 'text' || msg.msgType === 'voice' || msg.msgType === 'image' || msg.msgType === 'file') && !multiSelect && (
                  <Reactions msg={msg} meId={meId} onToggle={(e) => onToggleReaction(msg.id, e)} />
                )}
              </div>

              {/* hover 操作栏：回复 / 转发 / 更多 */}
              {!multiSelect && (onReply || onForward || onDeleteMessage) && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity self-center flex items-center gap-0.5">
                  {onReply && <button onClick={() => onReply(msg.id)} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="回复"><Reply size={15} /></button>}
                  {onForward && <button onClick={() => onForward(msg.id)} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="转发"><Forward size={15} /></button>}
                  {onToggleReaction && <button onClick={(e) => { e.stopPropagation(); setReactionFor(reactionFor === msg.id ? null : msg.id); }} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="表情"><Smile size={15} /></button>}
                  <button onClick={(e) => openMenu(e, msg.id)} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="更多"><MoreVertical size={15} /></button>
                </div>
              )}

              {/* 添加 reaction 面板 */}
              {reactionFor === msg.id && onToggleReaction && (
                <div className="absolute z-30 flex gap-1 p-1 rounded-full shadow-lg" style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }} onClick={(e) => e.stopPropagation()}>
                  {REACTION_EMOJIS.map(em => (
                    <button key={em} onClick={() => { onToggleReaction(msg.id, em); setReactionFor(null); }} className="text-lg hover:scale-125 transition-transform">{em}</button>
                  ))}
                </div>
              )}
            </div>
          </Fragment>
        );
      })
      )}

      {/* 内联权限确认 */}
      {permissionRequest && onPermissionAllow && onPermissionDeny && (
        <div className="ml-12">
          <InlinePermissionCard request={permissionRequest} onAllow={onPermissionAllow} onDeny={onPermissionDeny} />
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* 长按 / 右键菜单 */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="fixed z-50 min-w-[120px] rounded-xl shadow-xl py-1" style={{ top: menu.y, left: menu.x, backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}>
            {menuItems(messages.find(m => m.id === menu.id)!).map((it, idx) => (
              <button
                key={idx}
                onClick={it.onClick}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--td-bg-color-component-hover)]"
                style={{ color: it.danger ? '#e34d59' : 'var(--td-text-color-primary)' }}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
