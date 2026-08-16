import { useCallback, useEffect, useRef, useState } from 'react';
import type { Moment } from '../types';

export interface UseMomentsResult {
  moments: Moment[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  publish: (input: { content?: string; images?: string[] }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleLike: (id: string) => Promise<void>;
  comment: (id: string, content: string, replyTo?: string | null) => Promise<void>;
  loadMore: () => void;
  refresh: () => void;
}

function oldestCursor(moments: Moment[]): { createdAt: string; id: string } | null {
  if (moments.length === 0) return null;
  const m = moments[moments.length - 1];
  return { createdAt: m.createdAt, id: m.id };
}

export function useMoments(): UseMomentsResult {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<{ createdAt: string; id: string } | null>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (!reset && (loadingMoreRef.current || !hasMore)) return;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
      loadingMoreRef.current = true;
    }
    try {
      const params = new URLSearchParams();
      if (!reset && cursorRef.current) {
        params.set('beforeCreated', cursorRef.current.createdAt);
        params.set('beforeId', cursorRef.current.id);
      }
      const res = await fetch(`/api/moments?${params.toString()}`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      const page: Moment[] = data.moments || [];
      cursorRef.current = oldestCursor(page);
      setHasMore(!!data.hasMore);
      setMoments(prev => (reset ? page : [...prev, ...page]));
    } catch {
      // 忽略加载失败（保持已有内容）
    } finally {
      if (reset) setLoading(false);
      else {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, [hasMore]);

  useEffect(() => {
    cursorRef.current = null;
    setHasMore(true);
    fetchPage(true);
  }, [fetchPage]);

  const refresh = useCallback(() => {
    cursorRef.current = null;
    setHasMore(true);
    fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    fetchPage(false);
  }, [fetchPage]);

  const publish = useCallback(async (input: { content?: string; images?: string[] }) => {
    const res = await fetch('/api/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('发布失败');
    const data = await res.json();
    const moment: Moment = data.moment;
    setMoments(prev => [moment, ...prev]);
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/moments/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除失败');
    setMoments(prev => prev.filter(m => m.id !== id));
  }, []);

  const toggleLike = useCallback(async (id: string) => {
    const res = await fetch(`/api/moments/${id}/like`, { method: 'POST' });
    if (!res.ok) return;
    const data = await res.json();
    setMoments(prev => prev.map(m => m.id === id
      ? { ...m, likes: data.likes || [], likedByMe: !!data.likedByMe }
      : m));
  }, []);

  const comment = useCallback(async (id: string, content: string, replyTo: string | null = null) => {
    const res = await fetch(`/api/moments/${id}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, replyTo }),
    });
    if (!res.ok) throw new Error('评论失败');
    const data = await res.json();
    const c = data.comment;
    setMoments(prev => prev.map(m => m.id === id ? { ...m, comments: [...m.comments, c] } : m));
  }, []);

  return { moments, loading, loadingMore, hasMore, publish, remove, toggleLike, comment, loadMore, refresh };
}
