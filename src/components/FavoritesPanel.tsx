import { useEffect } from 'react';
import { Dialog, Button } from 'tdesign-react';
import { Star, Trash2, File as FileIcon, MessageCircle } from 'lucide-react';
import { Favorite } from '../types';

interface FavoritesPanelProps {
  visible: boolean;
  favorites: Favorite[];
  loading: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onOpenConversation: (conversationId: string) => void;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function FavoritesPanel({
  visible, favorites, loading, onClose, onRemove, onOpenConversation,
}: FavoritesPanelProps) {
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header="我的收藏"
      footer={null}
      width={460}
    >
      <div className="max-h-[60vh] overflow-y-auto -mx-2">
        {loading && favorites.length === 0 ? (
          <div className="text-center text-sm py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>加载中…</div>
        ) : favorites.length === 0 ? (
          <div className="text-center text-sm py-8 flex flex-col items-center gap-2" style={{ color: 'var(--td-text-color-placeholder)' }}>
            <Star size={28} />
            还没有收藏任何消息
          </div>
        ) : (
          <div className="space-y-2 px-2">
            {favorites.map(f => (
              <div
                key={f.id}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{ backgroundColor: 'var(--td-bg-color-component)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    <span className="font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>{f.senderName || '未知'}</span>
                    <span>{fmtTime(f.createdAt)}</span>
                  </div>
                  {f.msgType === 'image' && f.imagePath ? (
                    <img
                      src={`/api/image/${f.imagePath}`}
                      alt="收藏图片"
                      className="w-24 h-24 object-cover rounded-lg cursor-pointer"
                      onClick={() => { onOpenConversation(f.conversationId); onClose(); }}
                    />
                  ) : f.msgType === 'file' ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--td-text-color-primary)' }}>
                      <FileIcon size={16} />
                      <span className="truncate">{f.fileName}</span>
                    </div>
                  ) : (
                    <div
                      className="text-sm leading-snug break-words line-clamp-3 cursor-pointer"
                      style={{ color: 'var(--td-text-color-primary)' }}
                      onClick={() => { onOpenConversation(f.conversationId); onClose(); }}
                    >
                      {f.content || '[消息]'}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                  <button
                    className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]"
                    style={{ color: 'var(--td-text-color-secondary)' }}
                    title="查看原对话"
                    onClick={() => { onOpenConversation(f.conversationId); onClose(); }}
                  >
                    <MessageCircle size={16} />
                  </button>
                  <button
                    className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]"
                    style={{ color: '#e34d59' }}
                    title="取消收藏"
                    onClick={() => onRemove(f.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {favorites.length > 0 && (
        <div className="flex justify-end pt-3">
          <Button theme="default" onClick={onClose}>关闭</Button>
        </div>
      )}
    </Dialog>
  );
}
