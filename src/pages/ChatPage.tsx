import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Button, Tooltip, Loading } from 'tdesign-react';
import { Monitor, ArrowLeft, Trash2, MessageCircle, Users, Bot } from 'lucide-react';
import { Conversation, Contact, ConvMessage, PermissionRequest } from '../types';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';

interface ChatPageProps {
  conversation: Conversation;
  contacts: Contact[];
  meId: string;
  messages: ConvMessage[];
  isAgentThinking: boolean;
  permissionRequest: PermissionRequest | null;
  isAgentConversation: boolean;
  agentName: string;
  onSendText: (text: string, mentions?: string[]) => void;
  onSendVoice: (base64: string, ext: string, durationMs: number, transcript?: string) => void;
  onSendImage: (base64: string, ext: string) => void;
  onSendFile?: (base64: string, ext: string, name: string) => void;
  onSendAgentAssist: (text: string) => void;
  onStop: () => void;
  onPermissionAllow: () => void;
  onPermissionDeny: (message?: string) => void;
  onOpenRemoteAssist: () => void;
  onOpenAgentConfig: () => void;
  onBack: () => void;
  onClearMessages: () => void;
  onDeleteMessage: (id: string) => void;
  onForward: (id: string) => void;
  onRetry: (id: string) => void;
  onEditMessage?: (id: string, content: string) => void;
  onRecallMessage?: (id: string) => void;
  onToggleReaction?: (id: string, emoji: string) => void;
  onDeleteMessages?: (ids: string[]) => void;
  onBatchForward?: (ids: string[]) => void;
  typingMembers: string[];
  loadOlderMessages: () => Promise<void>;
  hasMoreMessages: boolean;
  isLoadingOlder: boolean;
  onManageGroup: () => void;
  /** 本机远程协助进行中（来自 useMessages 的实时流状态） */
  remoteAssistActive?: boolean;
}

function Avatar({ text, color, size = 28 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div className="rounded-md flex items-center justify-center text-white font-semibold" style={{ width: size, height: size, backgroundColor: color || '#888', fontSize: size * 0.4 }}>
      {text || '?'}
    </div>
  );
}

export function ChatPage({
  conversation, contacts, meId, messages, isAgentThinking, permissionRequest,
  isAgentConversation, agentName, onSendText, onSendVoice, onSendImage, onSendFile, onSendAgentAssist, onStop,
  onPermissionAllow, onPermissionDeny, onOpenRemoteAssist, onOpenAgentConfig, onBack,   onClearMessages, onDeleteMessage,
  onForward, onRetry, onEditMessage, onRecallMessage, onToggleReaction, onDeleteMessages, onBatchForward,
  typingMembers, loadOlderMessages, hasMoreMessages, isLoadingOlder, onManageGroup, remoteAssistActive,
}: ChatPageProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingOlderLocalRef = useRef(false);
  const prependingRef = useRef(false);
  const prevHeightRef = useRef(0);
  const lastConvIdRef = useRef<string | null>(null);
  const getContact = (id: string) => contacts.find(c => c.id === id);
  const members = conversation.participantIds.map(getContact).filter(Boolean) as Contact[];

  // 滚动到顶部时加载更早的历史消息；prepend 后保持滚动位置不跳动
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 80 && hasMoreMessages && !loadingOlderLocalRef.current) {
      prevHeightRef.current = el.scrollHeight;
      prependingRef.current = true;
      loadingOlderLocalRef.current = true;
      loadOlderMessages().finally(() => { loadingOlderLocalRef.current = false; });
    }
  }, [hasMoreMessages, loadOlderMessages]);

  // prepend 历史消息后，把滚动位置补偿回原处（避免跳到顶部）
  useLayoutEffect(() => {
    if (prependingRef.current && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight - prevHeightRef.current;
      prependingRef.current = false;
    }
  }, [messages]);

  // 切换会话后，等消息渲染完滚动到最新
  useEffect(() => {
    if (lastConvIdRef.current !== conversation.id) {
      lastConvIdRef.current = conversation.id;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [conversation.id, messages]);

  const [replyTo, setReplyTo] = useState<ConvMessage | null>(null);
  useEffect(() => { setReplyTo(null); }, [conversation.id]);

  // 多选模式（批量转发 / 删除）
  const [multiSelect, setMultiSelect] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  useEffect(() => { setMultiSelect(false); setSelection(new Set()); }, [conversation.id]);
  const exitMulti = useCallback(() => { setMultiSelect(false); setSelection(new Set()); }, []);
  const onToggleSelect = useCallback((id: string) => {
    setSelection(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);
  const onEnterMultiSelect = useCallback((id: string) => {
    setMultiSelect(true);
    setSelection(new Set([id]));
  }, []);

  const replyPreview = (m: ConvMessage): string => {
    if (m.msgType === 'voice') return '[语音]';
    if (m.msgType === 'system') return m.content || '';
    return (m.content || '').slice(0, 60);
  };
  const replyInfo = replyTo ? {
    id: replyTo.id,
    senderName: replyTo.senderId === meId ? '我' : (getContact(replyTo.senderId)?.name || '未知'),
    preview: replyPreview(replyTo),
  } : null;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* 顶部栏 */}
      <header
        className="h-14 flex items-center gap-3 px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--td-component-stroke)', backgroundColor: 'var(--td-bg-color-page)' }}
      >
        {multiSelect ? (
          <>
            <button onClick={exitMulti} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }} title="取消多选">
              <ArrowLeft />
            </button>
            <div className="flex-1 flex items-center gap-3">
              <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>已选 {selection.size} 项</span>
              <button onClick={() => onBatchForward?.([...selection])} className="px-3 py-1.5 rounded-lg text-sm" style={{ backgroundColor: '#07c160', color: '#fff' }}>转发</button>
              <button onClick={() => { onDeleteMessages?.([...selection]); exitMulti(); }} className="px-3 py-1.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)', color: '#e34d59' }}>删除</button>
            </div>
          </>
        ) : (
          <>
            <button onClick={onBack} className="md:hidden p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
              <ArrowLeft />
            </button>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                {conversation.title}
                {(conversation.remoteAssistActive || remoteAssistActive) && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(227,77,89,0.12)', color: '#e34d59' }}>协助中</span>}
              </div>
              {conversation.type === 'group' && (
                <div className="flex items-center gap-1 mt-0.5">
                  {members.slice(0, 6).map(m => <Avatar key={m.id} text={m.avatarText} color={m.avatarColor} size={18} />)}
                  {members.length > 6 && <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>+{members.length - 6}</span>}
                </div>
              )}
            </div>

            {isAgentConversation && (
              <Tooltip content="让助手操作你的电脑（远程协助）">
                <Button icon={<Monitor />} onClick={onOpenRemoteAssist} theme="danger" variant="outline">
                  远程协助
                </Button>
              </Tooltip>
            )}
            {isAgentConversation && (
              <Tooltip content="配置助手的权限模式、模型与提示词">
                <Button icon={<Bot />} onClick={onOpenAgentConfig} variant="outline">
                  助手设置
                </Button>
              </Tooltip>
            )}
            <Tooltip content="清空聊天记录">
              <Button icon={<Trash2 />} onClick={onClearMessages} variant="text">
                清空
              </Button>
            </Tooltip>
            {conversation.type === 'group' && (
              <Tooltip content="管理群成员与群名称">
                <Button icon={<Users />} onClick={onManageGroup} variant="text">
                  群管理
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </header>

      {/* 消息区 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
        <div className="flex justify-center py-2 h-8">
          {isLoadingOlder ? (
            <span className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}><Loading size="small" /> 加载更早消息…</span>
          ) : hasMoreMessages ? (
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>上滑加载更早消息</span>
          ) : null}
        </div>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center" style={{ color: 'var(--td-text-color-placeholder)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
              <MessageCircle size={28} />
            </div>
            <div className="text-sm">还没有消息</div>
            <div className="text-xs mt-1">发条消息开始聊天吧</div>
          </div>
        ) : (
          <ChatMessages
            messages={messages}
            contacts={contacts}
            meId={meId}
            isGroup={conversation.type === 'group'}
            messagesEndRef={endRef}
            scrollRef={scrollRef}
            permissionRequest={permissionRequest}
            onPermissionAllow={onPermissionAllow}
            onPermissionDeny={onPermissionDeny}
            onDeleteMessage={onDeleteMessage}
            onForward={onForward}
            onRetry={onRetry}
            onEdit={onEditMessage}
            onRecall={onRecallMessage}
            onToggleReaction={onToggleReaction}
            multiSelect={multiSelect}
            selection={selection}
            onToggleSelect={onToggleSelect}
            onEnterMultiSelect={onEnterMultiSelect}
            onReply={(id) => setReplyTo(messages.find(m => m.id === id) || null)}
          />
        )}
        {typingMembers.length > 0 && (
          <div className="flex items-center gap-2 px-1 py-2">
            <div className="flex -space-x-2">
              {typingMembers.slice(0, 3).map(id => {
                const c = getContact(id);
                return <Avatar key={id} text={c?.avatarText || '?'} color={c?.avatarColor || '#888'} size={22} />;
              })}
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
              <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                {typingMembers.length === 1 ? (getContact(typingMembers[0])?.name || '对方') : `${typingMembers.length} 人`} 正在输入
              </span>
              <span className="flex gap-0.5 items-center">
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--td-text-color-placeholder)' }} />
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--td-text-color-placeholder)', animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: 'var(--td-text-color-placeholder)', animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <ChatInput
        onSendText={onSendText}
        onSendVoice={onSendVoice}
        onSendImage={onSendImage}
        isAgentThinking={isAgentThinking}
        onStop={onStop}
        placeholder={isAgentConversation ? `和 ${agentName} 说说你需要什么帮助…` : '输入消息…'}
        isGroup={conversation.type === 'group'}
        members={members}
        meId={meId}
        replyTo={replyInfo}
        onCancelReply={() => setReplyTo(null)}
        onSendFile={onSendFile}
      />
    </div>
  );
}
