import { useState, useEffect, useRef, useCallback } from 'react';
import { Conversation, Contact, ConvMessage, PermissionRequest, ToolCall, QuoteRef } from '../types';
import { notifyAtMention } from '../lib/notifications';
import { buildWsUrl } from '../lib/auth';

interface SendToAgentOptions {
  model?: string;
  systemPrompt?: string;
  permissionMode?: string;
  cwd?: string;
  remoteAssist?: boolean;
}

export function useMessages(
  conversation: Conversation | null,
  contacts: Contact[],
  meId: string,
  onConversationUpdate?: (conv: Conversation) => void
) {
  const [messages, setMessages] = useState<ConvMessage[]>([]);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  // 本机远程协助进行中（本地流状态，协助结束即时归零，配合后端 remote_assist_active）
  const [remoteAssistActive, setRemoteAssistActive] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  // 当前会话里「正在输入」的模拟成员 id 列表（用于 typing 指示）
  const [typingMembers, setTypingMembers] = useState<string[]>([]);
  // 分页加载历史消息：游标 + 是否还有更早消息 + 加载中
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // 初次加载当前会话消息时的骨架屏标记（仅切会话时触发，后端重连/刷新不改变它）
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const cursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const loadingOlderRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const tempAgentIdRef = useRef<string | null>(null);
  // 当前会话的 WebSocket 连接（用于多端实时同步）
  const wsRef = useRef<WebSocket | null>(null);

  const conversationId = conversation?.id || null;
  // 当前会话 id 的实时引用：用于防止延迟自动回复串台（切到别的会话后旧回复不应落进来）
  const convIdRef = useRef<string | null>(conversationId);
  useEffect(() => { convIdRef.current = conversationId; }, [conversationId]);
  // 已处理过的消息（用于去重，避免切换会话/刷新时把历史 @ 消息重复弹通知）
  const seenIds = useRef<Set<string>>(new Set());

  const loadMessages = useCallback(async () => {
    if (!conversationId) { setMessages([]); return; }
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages?limit=30`);
      const data = await res.json();
      const msgs: ConvMessage[] = data.messages || [];
      // 预标记历史消息为「已读」，只有之后新增的消息才会触发通知
      msgs.forEach(m => seenIds.current.add(m.id));
      setMessages(msgs);
      cursorRef.current = data.oldest || null;
      setHasMoreMessages(data.hasMore ?? false);
    } catch (e) {
      console.error('加载消息失败', e);
    }
  }, [conversationId]);

  useEffect(() => {
    seenIds.current = new Set();
    setMessages([]);
    setIsAgentThinking(false);
    setPermissionRequest(null);
    setTypingMembers([]);
    cursorRef.current = null;
    setHasMoreMessages(true);
    loadingOlderRef.current = false;
    setIsLoadingOlder(false);
    setIsInitialLoading(true);
    loadMessages().finally(() => setIsInitialLoading(false));
  }, [conversationId, loadMessages]);

  // upsert helper
  const upsert = useCallback((msg: ConvMessage) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msg.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...msg };
        return copy;
      }
      return [...prev, msg];
    });
  }, []);

  const append = useCallback((msg: ConvMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  // 通过 WebSocket 广播「输入中」状态（多端实时同步）；仅在本会话已连接时发送。
  const sendTyping = useCallback((senderId: string, typing: boolean) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'typing', senderId, typing })); } catch { /* 忽略发送失败 */ }
    }
  }, []);

  // ============= WebSocket 实时同步（多标签页实时收发消息 / 已读 / 输入中） =============
  // 切到新会话时打开对应会话的 /ws 连接，离开/卸载时关闭并清理；后端重启时带退避重连。
  useEffect(() => {
    if (!conversationId || typeof window === 'undefined') return;
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempts = 0;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(buildWsUrl(`${proto}//${window.location.host}/ws?conversationId=${conversationId}`));
      socket = ws;
      wsRef.current = ws;

      ws.onopen = () => { attempts = 0; };

      ws.onmessage = (ev) => {
        let data: any;
        try { data = JSON.parse((ev as MessageEvent).data as string); } catch { return; }
        if (!data || typeof data.type !== 'string') return;
        switch (data.type) {
          case 'message:new': {
            const msg = data.message as ConvMessage;
            if (!msg || msg.conversationId !== conversationId) break;
            // 自己的消息已通过 HTTP 落库，这里仅做幂等补齐；保持「已发送」状态，避免被回显覆盖成 undefined
            upsert({ ...msg, status: msg.senderId === meId ? 'sent' : (msg.status || undefined) });
            break;
          }
          case 'message:read': {
            // 对方已读 → 把我发出的未读消息标记为已读
            setMessages(prev => prev.map(m =>
              (m.senderId === meId && !m.readAt) ? { ...m, readAt: new Date().toISOString() } : m
            ));
            break;
          }
          case 'message:update': {
            const msg = data.message as ConvMessage;
            if (!msg || msg.conversationId !== conversationId) break;
            upsert(msg);
            break;
          }
          case 'typing': {
            const sid = data.senderId as string;
            const typing = !!data.typing;
            if (!sid || sid === meId) break;
            setTypingMembers(prev => typing
              ? (prev.includes(sid) ? prev : [...prev, sid])
              : prev.filter(id => id !== sid));
            break;
          }
          case 'conversation:update': {
            // 群名称/头像/成员变更 → 实时刷新侧边栏与聊天头部（跨客户端同步）
            if (data.conversation && typeof data.conversation.id === 'string') {
              onConversationUpdate?.(data.conversation as Conversation);
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closed) return;
        if (attempts < 5) {
          attempts++;
          reconnectTimer = window.setTimeout(connect, 800 * attempts);
        }
      };
      ws.onerror = () => { try { ws.close(); } catch { /* 忽略 */ } };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) { try { socket.onclose = null; socket.close(); } catch { /* 忽略 */ } }
      wsRef.current = null;
    };
  }, [conversationId, upsert, meId]);

  // 加载更早的历史消息（滚动到顶时调用），prepend 到列表头部并保持滚动位置
  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || !cursorRef.current || !hasMoreMessages || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const { createdAt, id } = cursorRef.current;
      const res = await fetch(`/api/conversations/${conversationId}/messages?beforeCreatedAt=${encodeURIComponent(createdAt)}&beforeId=${encodeURIComponent(id)}&limit=30`);
      const data = await res.json();
      const older: ConvMessage[] = data.messages || [];
      if (older.length) setMessages(prev => [...older, ...prev]);
      cursorRef.current = data.oldest || null;
      setHasMoreMessages(data.hasMore ?? false);
    } catch (e) { console.error('加载更早消息失败', e); }
    finally { loadingOlderRef.current = false; setIsLoadingOlder(false); }
  }, [conversationId, hasMoreMessages]);

  // 本会话里会「自动搭话」的真人成员（用于让群聊有生气，也是 @ 通知的可演示来源）
  const getResponders = useCallback((): string[] => {
    if (!conversation) return [];
    return conversation.participantIds.filter(id => {
      if (id === meId) return false;
      const c = contacts.find(x => x.id === id);
      return c && !c.isAgent;
    });
  }, [conversation, contacts, meId]);

  const cannedReplies = [
    '收到～', '哈哈，好的', '这个想法不错👍', '我看看，稍等',
    '嗯嗯，明白了', '可以呀，几点？', '你说得对', '我这边没问题',
  ];

  // 让某个成员在稍后自动回复；mentionMe=true 时回 @ 我（触发桌面通知）。
  // 回复前先显示「正在输入…」（typing 指示），消息落库后再清除。
  const scheduleReply = useCallback((responderId: string, mentionMe: boolean) => {
    const delay = 1000 + Math.random() * 1800;
    const boundConv = conversationId;
    // 进入「正在输入」状态（本地 + 广播给其它端）
    setTypingMembers(prev => prev.includes(responderId) ? prev : [...prev, responderId]);
    sendTyping(responderId, true);
    const clearTyping = () => { setTypingMembers(prev => prev.filter(id => id !== responderId)); sendTyping(responderId, false); };
    window.setTimeout(async () => {
      // 已切换到其它会话则丢弃这条延迟自动回复，避免串台
      if (convIdRef.current !== boundConv) { clearTyping(); return; }
      const reply = cannedReplies[Math.floor(Math.random() * cannedReplies.length)];
      try {
        const res = await fetch(`/api/conversations/${boundConv}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: responderId, msgType: 'text', content: reply,
            meta: mentionMe ? { mentions: [meId] } : undefined,
          }),
        });
        const data = await res.json();
        if (data.message && convIdRef.current === boundConv) {
          append(data.message);
          // 对方回复即表示已读我之前发出的消息 —— 立即在前端更新「已读」回执
          setMessages(prev => prev.map(m =>
            (m.senderId === meId && !m.readAt) ? { ...m, readAt: new Date().toISOString() } : m
          ));
        }
      } catch (e) { console.error('自动回复失败', e); }
      finally { clearTyping(); }
    }, delay);
  }, [conversationId, append, meId, setMessages, sendTyping]);

  // 我发消息后，触发成员的自动回复逻辑（更拟真：被 @ 必回；否则随机一人，并有 30% 概率第二位接话）
  const triggerAutoReplies = useCallback((text: string, mentions: string[] = []) => {
    const responders = getResponders();
    if (responders.length === 0) return;
    const mentioned = responders.filter(r => mentions.includes(r));
    if (mentioned.length > 0) {
      // 被我 @ 的成员会回 @ 我 —— 这正是桌面通知要捕捉的场景
      mentioned.forEach(r => scheduleReply(r, true));
    } else {
      const r = responders[Math.floor(Math.random() * responders.length)];
      scheduleReply(r, false);
      // 多人群里偶尔有第二位成员接话，让对话更自然
      if (responders.length > 1 && Math.random() < 0.3) {
        const r2 = responders[Math.floor(Math.random() * responders.length)];
        if (r2 !== r) scheduleReply(r2, false);
      }
    }
  }, [getResponders, scheduleReply]);

  // 统一提交一条客户端消息（文本/语音/图片共用）：乐观插入（status: sending），
  // 服务端成功落库后 upsert 覆盖（clientId 即消息 id，天然去重）；网络错误或后端拒绝则标记为 failed，
  // 保留原始内容以便重试。tempId 用于重试时复用同一 clientId（即同一消息 id）。
  const commitClientMessage = useCallback(async (
    payload: Record<string, unknown>,
    tempId?: string,
  ): Promise<ConvMessage | null> => {
    if (!conversationId) return null;
    const clientId = tempId || crypto.randomUUID();
    const optimistic: ConvMessage = {
      id: clientId, conversationId, senderId: meId,
      msgType: (payload.msgType as ConvMessage['msgType']) || 'text',
      content: (payload.content as string) ?? null,
      transcript: (payload.transcript as string) ?? null,
      imagePath: (payload.imagePath as string) ?? null,
      audioPath: (payload.audioPath as string) ?? null,
      duration: (payload.duration as number) ?? null,
      meta: (payload.meta as ConvMessage['meta']) ?? null,
      fileName: (payload.fileName as string) ?? null,
      fileSize: (payload.fileSize as number) ?? null,
      fileMime: (payload.fileMime as string) ?? null,
      filePath: (payload.filePath as string) ?? null,
      videoPath: (payload.videoPath as string) ?? null,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    // 乐观插入 / 或重试时覆盖原失败消息
    upsert(optimistic);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: meId, clientId, ...payload }),
      });
      const data = await res.json();
      if (data.message) {
        // 服务端采用 clientId 作为消息 id，upsert 按 id 直接覆盖乐观消息，无需拼接
        upsert({ ...data.message, status: 'sent' } as ConvMessage);
        return data.message as ConvMessage;
      }
      // 后端明确拒绝（400/413/404 等）：保留内容，标记失败
      upsert({ ...optimistic, status: 'failed', failReason: data.error || '发送被拒绝' });
      return null;
    } catch (e) {
      // 网络错误：保留内容，标记失败，等待用户重试
      upsert({ ...optimistic, status: 'failed', failReason: '网络错误，发送失败' });
      return null;
    }
  }, [conversationId, meId, upsert]);

  // 重试一条失败的消息：用其已有字段重新发送，复用同一条临时消息 id
  const retryMessage = useCallback(async (id: string): Promise<ConvMessage | null> => {
    const m = messages.find(x => x.id === id);
    if (!m) return null;
    return commitClientMessage({
      msgType: m.msgType,
      content: m.content ?? undefined,
      imagePath: m.imagePath ?? undefined,
      audioPath: m.audioPath ?? undefined,
      duration: m.duration ?? undefined,
      meta: m.meta ?? undefined,
    }, id);
  }, [messages, commitClientMessage]);

  // 发送文本（通用，非 Agent 流式）。mentions/@列表，quote/引用回复
  const sendText = useCallback(async (text: string, mentions?: string[], quote?: QuoteRef) => {
    if (!conversationId || !text.trim()) return;
    const meta: any = {};
    if (mentions && mentions.length) meta.mentions = mentions;
    if (quote) meta.quote = quote;
    const msg = await commitClientMessage({
      msgType: 'text', content: text.trim(),
      meta: Object.keys(meta).length ? meta : undefined,
    });
    if (msg) triggerAutoReplies(text, mentions || []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送语音
  const sendVoice = useCallback(async (base64: string, ext: string, durationMs: number, transcript?: string) => {
    if (!conversationId) return;
    const up = await fetch('/api/voice/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, ext, duration: durationMs }),
    });
    const upData = await up.json();
    if (!upData.audioPath) { console.error('语音上传失败'); return; }
    const msg = await commitClientMessage({ msgType: 'voice', audioPath: upData.audioPath, duration: durationMs, transcript });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送图片
  const sendImage = useCallback(async (base64: string, ext: string) => {
    if (!conversationId) return;
    const up = await fetch('/api/image/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, ext }),
    });
    const upData = await up.json();
    if (!upData.imagePath) { console.error('图片上传失败'); return; }
    const msg = await commitClientMessage({ msgType: 'image', imagePath: upData.imagePath });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 桌面通知：扫描新收到的、@ 我的消息并弹出系统通知（依赖 seenIds 去重，不重复打扰）
  useEffect(() => {
    // 免打扰会话不弹通知（仍会照常计入未读）
    if (conversation?.muted) return;
    for (const m of messages) {
      if (seenIds.current.has(m.id)) continue;
      seenIds.current.add(m.id);
      if (m.senderId === meId) continue;
      const mentions = m.meta?.mentions || [];
      if (mentions.includes(meId)) {
        const sender = contacts.find(c => c.id === m.senderId);
        const senderName = sender?.name || '有人';
        const preview =
          m.msgType === 'image' ? '[图片]' :
          m.msgType === 'voice' ? '[语音]' :
          m.msgType === 'video' ? '[视频]' :
          m.msgType === 'sticker' ? '[表情]' :
          m.msgType === 'link' ? '[链接]' :
          m.msgType === 'location' ? '[位置]' :
          m.msgType === 'card' ? '[名片]' :
          (m.content || '');
        notifyAtMention(senderName, preview, m.conversationId);
      }
    }
  }, [messages, meId, contacts, conversation]);

  // 发送消息给 Agent（流式）
  const sendToAgent = useCallback(async (text: string, opts: SendToAgentOptions = {}) => {
    if (!conversationId || !text.trim()) return;
    const agentContact = contacts.find(c => c.isAgent && conversation!.participantIds.includes(c.id));
    if (!agentContact) return;

    // 乐观插入用户消息 + 流式占位
    const tempUser: ConvMessage = {
      id: `tmp_u_${Date.now()}`, conversationId, senderId: meId,
      msgType: 'text', content: text.trim(), createdAt: new Date().toISOString(),
    };
    const tempAgentId = `tmp_a_${Date.now()}`;
    tempAgentIdRef.current = tempAgentId;
    const tempAgent: ConvMessage = {
      id: tempAgentId, conversationId, senderId: agentContact.id,
      msgType: 'agent', content: '', isStreaming: true, toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    append(tempUser);
    append(tempAgent);
    setIsAgentThinking(true);
    setRemoteAssistActive(!!opts.remoteAssist);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/conversations/${conversationId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          model: opts.model || agentContact.agentConfig?.model,
          systemPrompt: opts.systemPrompt || agentContact.agentConfig?.systemPrompt,
          permissionMode: opts.permissionMode || agentContact.agentConfig?.permissionMode,
          cwd: opts.cwd || agentContact.agentConfig?.cwd,
          remoteAssist: !!opts.remoteAssist,
        }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取流式响应');
      const decoder = new TextDecoder();
      let buffer = '';

      const updateAgent = (patch: Partial<ConvMessage>) => {
        setMessages(prev => prev.map(m => m.id === tempAgentId ? { ...m, ...patch } : m));
      };
      const upsertTool = (tc: ToolCall) => {
        setMessages(prev => prev.map(m => {
          if (m.id !== tempAgentId) return m;
          const tools = [...(m.toolCalls || [])];
          const i = tools.findIndex(t => t.id === tc.id);
          if (i >= 0) tools[i] = { ...tools[i], ...tc };
          else tools.push(tc);
          return { ...m, toolCalls: tools };
        }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let evt: any;
          try { evt = JSON.parse(json); } catch { continue; }
          if (evt.type === 'text') {
            setMessages(prev => prev.map(m => m.id === tempAgentId
              ? { ...m, content: (m.content || '') + evt.content } : m));
          } else if (evt.type === 'tool') {
            upsertTool({ id: evt.id, name: evt.name, input: evt.input, status: 'running' });
          } else if (evt.type === 'tool_result') {
            upsertTool({ id: evt.toolId, name: evt.name || 'tool', status: evt.isError ? 'error' : 'completed', result: evt.content, isError: evt.isError });
          } else if (evt.type === 'permission_request') {
            setPermissionRequest({
              requestId: evt.requestId, toolUseId: evt.toolUseId, toolName: evt.toolName,
              input: evt.input, conversationId, timestamp: evt.timestamp,
            });
          } else if (evt.type === 'done' || evt.type === 'error') {
            updateAgent({ isStreaming: false });
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Agent 请求失败', e);
      }
    } finally {
      setIsAgentThinking(false);
      setPermissionRequest(null);
      setRemoteAssistActive(false);
      tempAgentIdRef.current = null;
      // 从服务器重新加载：丢弃临时消息，保留持久化结果（后端在成功/出错时都会落库）
      await loadMessages();
    }
  }, [conversationId, contacts, conversation, meId, append, loadMessages]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setRemoteAssistActive(false);
  }, []);

  const handlePermissionAllow = useCallback(() => {
    if (!permissionRequest) return;
    fetch('/api/permission-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: permissionRequest.requestId, behavior: 'allow' }),
    });
    setPermissionRequest(null);
  }, [permissionRequest]);

  const handlePermissionDeny = useCallback((message?: string) => {
    if (!permissionRequest) return;
    fetch('/api/permission-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: permissionRequest.requestId, behavior: 'deny', message: message || '用户拒绝' }),
    });
    setPermissionRequest(null);
  }, [permissionRequest]);

  const deleteMessage = useCallback(async (msgId: string) => {
    try {
      await fetch(`/api/conversations/${conversationId}/messages/${msgId}`, { method: 'DELETE' });
    } catch (e) { console.error('删除消息失败', e); }
    setMessages(prev => prev.filter(m => m.id !== msgId));
  }, [conversationId]);

  // 批量删除消息
  const deleteMessages = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      try { await fetch(`/api/conversations/${conversationId}/messages/${id}`, { method: 'DELETE' }); } catch { /* 忽略单条失败 */ }
    }
    setMessages(prev => prev.filter(m => !ids.includes(m.id)));
  }, [conversationId]);

  // 撤回消息（仅本人、2 分钟窗口由后端校验）
  const recallMessage = useCallback(async (msgId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${msgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recall', senderId: meId }),
      });
      const data = await res.json();
      if (data.message) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...data.message } : m));
      else if (data.error) console.warn('撤回失败:', data.error);
    } catch (e) { console.error('撤回失败', e); }
  }, [conversationId, meId]);

  // 编辑文本消息（仅本人、仅文本）
  const editMessage = useCallback(async (msgId: string, content: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${msgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', senderId: meId, content }),
      });
      const data = await res.json();
      if (data.message) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...data.message } : m));
    } catch (e) { console.error('编辑失败', e); }
  }, [conversationId, meId]);

  // 表情 reaction 切换
  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${msgId}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, userId: meId }),
      });
      const data = await res.json();
      if (data.message) setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...data.message } : m));
    } catch (e) { console.error('reaction 失败', e); }
  }, [conversationId, meId]);

  // 发送文件消息
  const sendFile = useCallback(async (base64: string, ext: string, name: string) => {
    if (!conversationId) return;
    const up = await fetch('/api/file/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: base64, ext, name }),
    });
    const upData = await up.json();
    if (!upData.filePath) { console.error('文件上传失败'); return; }
    const msg = await commitClientMessage({ msgType: 'file', fileName: upData.name, fileSize: upData.size, fileMime: null, filePath: upData.filePath });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送大表情（贴纸）
  const sendSticker = useCallback(async (emoji: string) => {
    if (!conversationId || !emoji.trim()) return;
    const msg = await commitClientMessage({ msgType: 'sticker', content: emoji.trim() });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送链接卡片
  const sendLink = useCallback(async (url: string, title?: string, description?: string) => {
    if (!conversationId || !url.trim()) return;
    const msg = await commitClientMessage({
      msgType: 'link', content: url.trim(),
      meta: { link: { url: url.trim(), title, description } },
    });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送视频消息
  const sendVideo = useCallback(async (base64: string, ext: string) => {
    if (!conversationId) return;
    const up = await fetch('/api/video/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video: base64, ext }),
    });
    const upData = await up.json();
    if (!upData.videoPath) { console.error('视频上传失败'); return; }
    const msg = await commitClientMessage({ msgType: 'video', videoPath: upData.videoPath, content: '' });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送位置消息
  const sendLocation = useCallback(async (lat: number, lng: number, name?: string, address?: string) => {
    if (!conversationId) return;
    const msg = await commitClientMessage({
      msgType: 'location', content: name || '位置',
      meta: { location: { lat, lng, name, address } },
    });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, commitClientMessage, triggerAutoReplies]);

  // 发送名片（分享联系人）
  const sendCard = useCallback(async (contactId: string) => {
    if (!conversationId) return;
    const c = contacts.find(x => x.id === contactId);
    if (!c || c.id === meId) return;
    const msg = await commitClientMessage({
      msgType: 'card', content: c.name,
      meta: {
        card: {
          cardId: c.id, cardName: c.name,
          cardAvatarText: c.avatarText, cardAvatarColor: c.avatarColor, cardIsAgent: c.isAgent,
        },
      },
    });
    if (msg) triggerAutoReplies('', []);
  }, [conversationId, contacts, meId, commitClientMessage, triggerAutoReplies]);

  return {
    messages, loadMessages, sendText, sendVoice, sendImage, sendToAgent, retryMessage,
    loadOlderMessages, hasMoreMessages, isLoadingOlder, isInitialLoading,
    typingMembers, isAgentThinking, permissionRequest, handleStop, remoteAssistActive,
    handlePermissionAllow, handlePermissionDeny, deleteMessage,
    recallMessage, editMessage, toggleReaction, sendFile, deleteMessages,
    sendSticker, sendLink, sendVideo, sendLocation, sendCard,
  };
}
