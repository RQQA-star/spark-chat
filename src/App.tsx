import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from 'tdesign-react';
import { Bot, Users, MessageCircle } from 'lucide-react';

import { useTheme } from './hooks/useTheme';
import { useContacts } from './hooks/useContacts';
import { useConversations } from './hooks/useConversations';
import { useMessages } from './hooks/useMessages';
import { useFavorites } from './hooks/useFavorites';
import { useSettings } from './hooks/useSettings';

import { Sidebar } from './components/Sidebar';
import { ChatPage } from './pages/ChatPage';
import { MomentsPage } from './pages/MomentsPage';
import { NewGroupDialog } from './components/NewGroupDialog';
import { GroupManagePanel } from './components/GroupManagePanel';
import { RemoteAssistPanel } from './components/RemoteAssistPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { SearchModal } from './components/SearchModal';
import { ForwardDialog } from './components/ForwardDialog';
import { AgentConfigDialog } from './components/AgentConfigDialog';
import { Lightbox } from './components/Lightbox';
import { ContactCardDialog } from './components/ContactCardDialog';
import { FavoritesPanel } from './components/FavoritesPanel';
import { VideoCallDialog } from './components/VideoCallDialog';
import { Conversation, ConvMessage, Contact, QuoteRef } from './types';
import { getNotificationState, requestNotificationPermission, setActivateHandler, setActiveConversation, NotifState } from './lib/notifications';
import { getToken, setToken, fetchAuthConfig } from './lib/auth';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { contacts, me, getContact, agentContacts, addContact, deleteContact, updateContact } = useContacts();
  const { conversations, createConversation, deleteConversation, clearMessages, addMember, removeMember, renameConversation, setAnnouncement, fetchConversations, applyConversationUpdate, setConversationPinned, setConversationMuted, markAllRead } = useConversations();
  const { favorites, fetchFavorites, addFavorite, removeFavorite } = useFavorites();
  const { fontScale, setFontScale, chatBg, setChatBg } = useSettings();

  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  // 主视图切换：聊天 / 朋友圈
  const [view, setView] = useState<'chat' | 'moments'>('chat');
  const [groupDialog, setGroupDialog] = useState(false);
  const [groupManage, setGroupManage] = useState(false);
  const [remoteAssist, setRemoteAssist] = useState(false);
  const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusMsg, setFocusMsg] = useState<{ id: string; nonce: number } | null>(null);
  // 撤回后「重新编辑」回填（text + nonce 触发 ChatInput 的 prefill effect）
  const [reeditMsg, setReeditMsg] = useState<{ text: string; nonce: number } | null>(null);
  // 各会话未发送草稿（切换会话后回填输入框，并在会话列表显示「[草稿]」）
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 已播放的语音消息（localStorage 持久化，控制未读红点）
  const [playedVoice, setPlayedVoice] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('spark:playedVoice');
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  // 待转发的内容：可能是单条消息，也可能是多选合并后的「聊天记录」
  const [pendingForward, setPendingForward] = useState<{ message?: ConvMessage; merged?: { title: string; content: string } } | null>(null);
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotifState>(getNotificationState());
  // P1 新交互：大图灯箱 / 个人名片页 / 收藏面板
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [cardContact, setCardContact] = useState<Contact | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  // 访问令牌引导：服务端启用 SPARK_ACCESS_TOKEN 且本地无令牌时，弹出输入界面
  const [needToken, setNeedToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  // 视频通话（本地模拟）弹窗
  const [videoCall, setVideoCall] = useState<{ name: string; text?: string | null; color?: string | null; isGroup?: boolean } | null>(null);

  // 注册「点击通知跳转到对应会话」的回调，并维护当前查看的会话
  useEffect(() => {
    setActivateHandler((convId: string) => setCurrentConversationId(convId));
    return () => setActivateHandler(null);
  }, []);

  // 启动探测：服务端是否要求访问令牌；若需要且本地未存令牌，弹出输入界面
  useEffect(() => {
    let cancelled = false;
    fetchAuthConfig().then(({ tokenRequired }) => {
      if (!cancelled && tokenRequired && !getToken()) setNeedToken(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setActiveConversation(currentConversationId);
  }, [currentConversationId]);

  // 切换会话时清掉「重新编辑」回填，避免跨会话误填
  useEffect(() => { setReeditMsg(null); }, [currentConversationId]);

  const enableNotifications = useCallback(async () => {
    const p = await requestNotificationPermission();
    setNotifPerm(p);
  }, []);

  const currentConversation: Conversation | undefined = useMemo(
    () => conversations.find(c => c.id === currentConversationId),
    [conversations, currentConversationId]
  );

  const isAgentConversation = !!currentConversation?.participantIds.some(id => getContact(id)?.isAgent);
  const agentContact = agentContacts[0];
  const agentName = agentContact?.name || '星火助手';
  const currentAgentContact = currentConversation?.participantIds.map(getContact).find(c => c?.isAgent) || null;

  // 发起视频通话（本地模拟）：根据当前会话推导出对端信息
  const handleStartVideoCall = useCallback(() => {
    if (!currentConversation) return;
    if (currentConversation.type === 'group') {
      setVideoCall({ name: currentConversation.title || '群聊', text: currentConversation.avatarText, color: currentConversation.avatarColor, isGroup: true });
    } else {
      const peer = getContact(currentConversation.participantIds.find(id => id !== me.id) || '');
      setVideoCall({
        name: peer?.name || '对方',
        text: peer?.avatarText ?? null,
        color: peer?.avatarColor ?? null,
        isGroup: false,
      });
    }
  }, [currentConversation, getContact, me.id]);

  const {
    messages, sendText, sendVoice, sendImage, sendToAgent, retryMessage, typingMembers, isAgentThinking,
    permissionRequest, handleStop, handlePermissionAllow, handlePermissionDeny, deleteMessage, loadMessages,
    loadOlderMessages, hasMoreMessages, isLoadingOlder, remoteAssistActive, isInitialLoading,
    recallMessage, editMessage, toggleReaction, sendFile, deleteMessages,
    sendSticker, sendLink, sendVideo, sendLocation, sendCard, sendPat,
  } = useMessages(currentConversation || null, contacts, me.id, applyConversationUpdate);

  // 路由发送：Agent 会话走流式，否则普通文本（群聊携带 @ 成员 / 引用回复）
  const handleSendText = useCallback((text: string, mentions?: string[], quote?: QuoteRef) => {
    if (isAgentConversation) sendToAgent(text);
    else sendText(text, mentions, quote);
  }, [isAgentConversation, sendToAgent, sendText]);

  // 双击头像拍一拍
  const handlePat = useCallback((targetId: string) => {
    sendPat(targetId);
  }, [sendPat]);
  const handleReedit = useCallback((content: string) => {
    setReeditMsg({ text: content, nonce: Date.now() });
  }, []);
  const handleDraftChange = useCallback((convId: string, text: string) => {
    const t = text ?? '';
    setDrafts((prev) => {
      if (!t) {
        if (!prev[convId]) return prev;
        const next = { ...prev };
        delete next[convId];
        return next;
      }
      if (prev[convId] === t) return prev;
      return { ...prev, [convId]: t };
    });
  }, []);
  // 标记语音已播放（持久化，未读红点消失）
  const markVoicePlayed = useCallback((id: string) => {
    setPlayedVoice((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem('spark:playedVoice', JSON.stringify([...next])); } catch { /* 忽略 */ }
      return next;
    });
  }, []);

  const handleSendAgentAssist = useCallback((text: string) => {
    setRemoteAssist(false);
    sendToAgent(text, { remoteAssist: true });
  }, [sendToAgent]);

  // 打开某个会话（同时切回聊天视图）
  const openConversation = useCallback((id: string) => {
    setView('chat');
    setCurrentConversationId(id);
  }, []);

  const handleSelectContact = useCallback(async (contactId: string) => {
    const conv = await createConversation({ type: 'direct', participantIds: [contactId] });
    openConversation(conv.id);
  }, [createConversation, openConversation]);

  const handleCreateGroup = useCallback(async (input: { type: 'group'; participantIds: string[]; title?: string; avatarText?: string; avatarColor?: string }) => {
    const conv = await createConversation(input);
    openConversation(conv.id);
  }, [createConversation, openConversation]);

  const handleSearchSelect = useCallback((conversationId: string, messageId: string) => {
    setSearchOpen(false);
    setFocusMsg({ id: messageId, nonce: Date.now() });
    openConversation(conversationId);
  }, [openConversation]);

  const clearFocus = useCallback(() => setFocusMsg(null), []);

  const previewOf = (m: ConvMessage): string => {
    if (m.recalled) return '撤回了一条消息';
    if (m.msgType === 'voice') return '[语音]';
    if (m.msgType === 'image') return '[图片]';
    if (m.msgType === 'file') return `[文件] ${m.fileName || ''}`;
    if (m.msgType === 'merged') return '[聊天记录]';
    return (m.content || '').slice(0, 80);
  };

  const handleForward = useCallback((messageId: string) => {
    const m = messages.find(x => x.id === messageId);
    if (m) setPendingForward({ message: m });
  }, [messages]);

  // 多选合并转发：把若干条消息打包成「聊天记录」卡片转发
  const handleBatchForward = useCallback((ids: string[]) => {
    const selected = ids.map(id => messages.find(m => m.id === id)).filter(Boolean) as ConvMessage[];
    if (selected.length === 0) return;
    const items = selected.map(m => {
      const senderName = m.senderId === me.id ? '我' : (contacts.find(c => c.id === m.senderId)?.name || '对方');
      const time = new Date(m.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return { senderName, time, preview: previewOf(m) };
    });
    const title = `${currentConversation?.title || '聊天'} 的聊天记录（${items.length} 条）`;
    setPendingForward({ merged: { title, content: JSON.stringify({ title, items }) } });
  }, [messages, currentConversation, me.id, contacts]);

  const handlePickForward = useCallback(async (targetId: string) => {
    const pending = pendingForward;
    if (!pending || !currentConversation) { setPendingForward(null); return; }
    // 合并转发：整段聊天记录作为一条 merged 消息
    if (pending.merged) {
      try {
        await fetch(`/api/conversations/${targetId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ senderId: me.id, msgType: 'merged', content: pending.merged.content }),
        });
        fetchConversations();
      } catch {}
      setPendingForward(null);
      return;
    }
    const m = pending.message;
    if (!m) { setPendingForward(null); return; }
    const payload: any = {
      senderId: me.id,
      meta: { forwardedFromName: currentConversation.title },
    };
    // 按原始消息类型转发，避免丢字段（图片丢 imagePath、agent/system 被服务端拒收）
    switch (m.msgType) {
      case 'voice':
        payload.msgType = 'voice';
        payload.audioPath = m.audioPath;
        payload.duration = m.duration;
        break;
      case 'image':
        if (m.imagePath) {
          payload.msgType = 'image';
          payload.imagePath = m.imagePath;
          payload.content = m.content || ''; // 图片说明作为文本
        } else {
          payload.msgType = 'text';
          payload.content = m.content || '[图片]';
        }
        break;
      case 'agent':
      case 'system':
        // agent/system 为服务端内部类型，客户端转发时降级为文本摘要
        payload.msgType = 'text';
        payload.content = m.content || (m.msgType === 'agent' ? '[助手消息]' : '[系统消息]');
        break;
      default:
        payload.msgType = 'text';
        payload.content = m.content || '';
    }
    try {
      await fetch(`/api/conversations/${targetId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      fetchConversations();
    } catch {}
    setPendingForward(null);
  }, [pendingForward, currentConversation, me.id, fetchConversations]);

  // 大图灯箱
  const handlePreviewImage = useCallback((imagePath: string) => setLightbox(imagePath), []);
  // 个人名片页
  const handlePreviewContact = useCallback((id: string) => {
    const c = getContact(id);
    if (c) setCardContact(c);
  }, [getContact]);
  // 收藏
  const handleFavorite = useCallback(async (messageId: string) => {
    if (!currentConversationId) return;
    await addFavorite(messageId, currentConversationId);
  }, [currentConversationId, addFavorite]);
  // 星标朋友切换
  const handleToggleStar = useCallback(async (id: string, starred: boolean) => {
    await updateContact(id, { starred });
  }, [updateContact]);
  // 打开收藏面板
  const openFavorites = useCallback(() => {
    fetchFavorites();
    setFavoritesOpen(true);
  }, [fetchFavorites]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      <Sidebar
        conversations={conversations}
        contacts={contacts}
        currentConversationId={currentConversationId}
        onSelectConversation={openConversation}
        onSelectContact={handleSelectContact}
        onCreateGroup={() => setGroupDialog(true)}
        onDeleteConversation={deleteConversation}
        onAddContact={addContact}
        onDeleteContact={deleteContact}
        onEditContact={(id, updates) => updateContact(id, updates)}
        onOpenSettings={() => setSettings(true)}
        onOpenSearch={() => setSearchOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onEnableNotifications={enableNotifications}
        notifState={notifPerm}
        onTogglePin={setConversationPinned}
        onToggleMute={setConversationMuted}
        onToggleStar={handleToggleStar}
        onOpenContactCard={handlePreviewContact}
        onMarkAllRead={markAllRead}
        onOpenFavorites={openFavorites}
        onOpenRemoteAssist={() => setRemoteAssist(true)}
        activeView={view}
        drafts={drafts}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full">
        {view === 'moments' ? (
          <MomentsPage meId={me.id} onBack={() => setView('chat')} />
        ) : currentConversation ? (
          <ChatPage
            conversation={currentConversation}
            contacts={contacts}
            meId={me.id}
            messages={messages}
            isAgentThinking={isAgentThinking}
            permissionRequest={permissionRequest}
            isAgentConversation={isAgentConversation}
            agentName={agentName}
            onSendText={handleSendText}
            onSendVoice={sendVoice}
            onSendImage={sendImage}
            onSendAgentAssist={handleSendAgentAssist}
            onStop={handleStop}
            onPermissionAllow={handlePermissionAllow}
            onPermissionDeny={handlePermissionDeny}
            onOpenRemoteAssist={() => setRemoteAssist(true)}
            onBack={() => setCurrentConversationId(null)}
            onClearMessages={() => { if (currentConversation) clearMessages(currentConversation.id); }}
            onDeleteMessage={deleteMessage}
            onForward={handleForward}
            onEditMessage={editMessage}
            onRecallMessage={recallMessage}
            onToggleReaction={toggleReaction}
            onDeleteMessages={deleteMessages}
            onBatchForward={handleBatchForward}
            onSendFile={sendFile}
            onSendSticker={sendSticker}
            onSendLink={sendLink}
            onSendVideo={sendVideo}
            onSendLocation={sendLocation}
            onSendCard={sendCard}
            onPreviewImage={handlePreviewImage}
            onPreviewContact={handlePreviewContact}
            onPat={handlePat}
            onReedit={handleReedit}
            onFavorite={handleFavorite}
            playedVoice={playedVoice}
            onVoicePlayed={markVoicePlayed}
            draft={currentConversationId ? (drafts[currentConversationId] || '') : ''}
            onDraftChange={(text) => handleDraftChange(currentConversationId || '', text)}
            onRetry={retryMessage}
            typingMembers={typingMembers}
            loadOlderMessages={loadOlderMessages}
            hasMoreMessages={hasMoreMessages}
            isLoadingOlder={isLoadingOlder}
            loading={isInitialLoading}
            onManageGroup={() => setGroupManage(true)}
            onOpenAgentConfig={() => setAgentConfigOpen(true)}
            remoteAssistActive={remoteAssistActive}
            onStartVideoCall={handleStartVideoCall}
            focusMessageId={focusMsg?.id ?? null}
            onClearFocusMessage={clearFocus}
            reedit={reeditMsg}
          />
        ) : (
          <Welcome
            onChatAgent={() => agentContact && handleSelectContact(agentContact.id)}
            onCreateGroup={() => setGroupDialog(true)}
          />
        )}
      </main>

      <NewGroupDialog
        visible={groupDialog}
        contacts={contacts}
        onClose={() => setGroupDialog(false)}
        onCreate={handleCreateGroup}
      />

      {currentConversation && currentConversation.type === 'group' && (
        <GroupManagePanel
          visible={groupManage}
          conversation={currentConversation}
          contacts={contacts}
          meId={me.id}
          onClose={() => setGroupManage(false)}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onRename={renameConversation}
          onSetAnnouncement={setAnnouncement}
          onReloadMessages={loadMessages}
        />
      )}

      <RemoteAssistPanel
        visible={remoteAssist}
        agentName={agentName}
        onClose={() => setRemoteAssist(false)}
        onSendLocalAssist={handleSendAgentAssist}
      />

      <SettingsPanel visible={settings} onClose={() => setSettings(false)} theme={theme} onToggleTheme={toggleTheme} notification={{ state: notifPerm, onEnable: enableNotifications }} fontScale={fontScale} onFontScale={setFontScale} chatBg={chatBg} onChatBg={setChatBg} />

      <SearchModal
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSearchSelect}
      />

      <ForwardDialog
        visible={!!pendingForward}
        conversations={conversations}
        currentConversationId={currentConversationId}
        onClose={() => setPendingForward(null)}
        onPick={handlePickForward}
      />

      <AgentConfigDialog
        visible={agentConfigOpen}
        contact={currentAgentContact}
        onClose={() => setAgentConfigOpen(false)}
        onSave={async (cfg) => { if (currentAgentContact) await updateContact(currentAgentContact.id, { agentConfig: cfg }); }}
      />

      <Lightbox imagePath={lightbox} onClose={() => setLightbox(null)} />

      <ContactCardDialog
        visible={!!cardContact}
        contact={cardContact}
        meId={me.id}
        onClose={() => setCardContact(null)}
        onSaveRemark={async (id, remark) => { await updateContact(id, { remark }); }}
        onToggleStar={handleToggleStar}
        onMessage={handleSelectContact}
      />

      <FavoritesPanel
        visible={favoritesOpen}
        favorites={favorites}
        loading={false}
        onClose={() => setFavoritesOpen(false)}
        onRemove={removeFavorite}
        onOpenConversation={(cid) => { setCurrentConversationId(cid); }}
      />

      <VideoCallDialog
        visible={!!videoCall}
        peerName={videoCall?.name || ''}
        peerAvatarText={videoCall?.text ?? null}
        peerAvatarColor={videoCall?.color ?? null}
        isGroup={videoCall?.isGroup}
        onClose={() => setVideoCall(null)}
      />

      {needToken && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div
            className="rounded-2xl p-6 w-80 max-w-[90vw] flex flex-col gap-3"
            style={{ backgroundColor: 'var(--td-bg-color-container)' }}
          >
            <div className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>需要访问令牌</div>
            <div className="text-sm leading-relaxed" style={{ color: 'var(--td-text-color-secondary)' }}>
              此服务已启用访问令牌鉴权。请输入部署时配置的访问令牌以继续使用（仅保存在本机浏览器）。
            </div>
            <input
              type="password"
              value={tokenInput}
              autoFocus
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tokenInput.trim()) {
                  setToken(tokenInput.trim());
                  window.location.reload();
                }
              }}
              placeholder="访问令牌"
              className="px-3 py-2 rounded-lg outline-none"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-border)' }}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="text" onClick={() => setNeedToken(false)}>稍后</Button>
              <Button
                theme="primary"
                disabled={!tokenInput.trim()}
                onClick={() => { setToken(tokenInput.trim()); window.location.reload(); }}
              >
                确认
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Welcome({ onChatAgent, onCreateGroup }: { onChatAgent: () => void; onCreateGroup: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ backgroundColor: '#07c160' }}>
        <span className="text-white text-3xl font-bold">星</span>
      </div>
      <div className="text-center">
        <div className="text-2xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>星火聊天</div>
        <div className="text-sm mt-2 max-w-md" style={{ color: 'var(--td-text-color-secondary)' }}>
          像微信一样聊天：单聊、群聊、发语音。还能召唤内置的「星火助手」(CodeBuddy Agent)，并发起远程协助让它帮你操作电脑。
        </div>
      </div>
      <div className="flex gap-3">
        <Button icon={<Bot />} theme="primary" onClick={onChatAgent}>和星火助手聊聊</Button>
        <Button icon={<Users />} variant="outline" onClick={onCreateGroup}>发起群聊</Button>
      </div>
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
        <MessageCircle /> 从左侧「通讯录」选择联系人即可开始对话
      </div>
    </div>
  );
}
