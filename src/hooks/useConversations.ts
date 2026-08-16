import { useState, useEffect, useCallback } from 'react';
import { Conversation } from '../types';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (e) {
      console.error('获取会话失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const createConversation = useCallback(async (input: {
    type: 'direct' | 'group';
    participantIds: string[];
    title?: string;
    avatarText?: string;
    avatarColor?: string;
    isRemoteAssist?: boolean;
  }) => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (data.conversation) {
      setConversations(prev => {
        // 去重（direct 已存在时后端返回 existed）
        const filtered = prev.filter(c => c.id !== data.conversation.id);
        return [data.conversation, ...filtered];
      });
    }
    return data.conversation as Conversation;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations(prev => prev.filter(c => c.id !== id));
  }, []);

  const clearMessages = useCallback(async (id: string) => {
    await fetch(`/api/conversations/${id}/messages`, { method: 'DELETE' });
    setConversations(prev => prev.map(c => c.id === id ? { ...c, messageCount: 0, lastMessage: null } : c));
  }, []);

  const addMember = useCallback(async (convId: string, contactId: string) => {
    const res = await fetch(`/api/conversations/${convId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json();
    if (Array.isArray(data.participantIds)) {
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, participantIds: data.participantIds } : c));
    }
    return data.participantIds as string[];
  }, []);

  const removeMember = useCallback(async (convId: string, contactId: string) => {
    const res = await fetch(`/api/conversations/${convId}/participants/${contactId}`, { method: 'DELETE' });
    const data = await res.json();
    if (Array.isArray(data.participantIds)) {
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, participantIds: data.participantIds } : c));
    }
    return data;
  }, []);

  const renameConversation = useCallback(async (convId: string, title: string) => {
    const res = await fetch(`/api/conversations/${convId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (data.conversation?.title) {
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: data.conversation.title } : c));
    }
  }, []);

  // 跨客户端实时同步：合并后端广播的 conversation:update 到列表（群名/头像/成员变更）
  const applyConversationUpdate = useCallback((conv: Conversation) => {
    setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, ...conv } : c));
  }, []);

  const setConversationPinned = useCallback(async (id: string, pinned: boolean) => {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
    const data = await res.json();
    if (data.conversation) setConversations(prev => prev.map(c => c.id === id ? { ...c, pinned: !!data.conversation.pinned } : c));
  }, []);

  const setConversationMuted = useCallback(async (id: string, muted: boolean) => {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted }),
    });
    const data = await res.json();
    if (data.conversation) setConversations(prev => prev.map(c => c.id === id ? { ...c, muted: !!data.conversation.muted } : c));
  }, []);

  return { conversations, loading, fetchConversations, createConversation, deleteConversation, clearMessages, addMember, removeMember, renameConversation, applyConversationUpdate, setConversationPinned, setConversationMuted };
}
