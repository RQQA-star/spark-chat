import { useState, useCallback } from 'react';
import { Favorite } from '../types';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/favorites');
      const data = await res.json();
      setFavorites(data.favorites || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const addFavorite = useCallback(async (messageId: string, conversationId: string) => {
    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, conversationId }),
      });
      const data = await res.json();
      if (data.favorite) {
        setFavorites(prev => [data.favorite, ...prev.filter(f => f.messageId !== messageId)]);
        return data;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, []);

  const removeFavorite = useCallback(async (id: string) => {
    try {
      await fetch(`/api/favorites/${id}`, { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    setFavorites(prev => prev.filter(f => f.id !== id));
  }, []);

  return { favorites, loading, fetchFavorites, addFavorite, removeFavorite };
}
