import { useState, useRef, useEffect } from 'react';
import { Button, Loading } from 'tdesign-react';
import { ImagePlus, Heart, MessageCircle, Send, Trash2, ArrowLeft, X } from 'lucide-react';
import { Moment, MomentComment } from '../types';
import { useMoments } from '../hooks/useMoments';

function Avatar({ text, color, size = 40 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#888', fontSize: size * 0.4 }}
    >
      {text || '?'}
    </div>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function likeSummary(m: Moment): string {
  if (m.likes.length === 0) return '';
  const display = m.likes.map(l => l.name);
  if (display.length <= 3) return display.join('、') + ' 赞了';
  return `${display.slice(0, 2).join('、')} 等 ${display.length} 人赞了`;
}

export function MomentsPage({ meId, onBack }: { meId: string; onBack: () => void }) {
  const { moments, loading, loadingMore, hasMore, publish, remove, toggleLike, comment, loadMore } = useMoments();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]); // 已上传的文件名
  const [pickedPreviews, setPickedPreviews] = useState<string[]>([]); // 本地预览 data URL
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [commentFor, setCommentFor] = useState<{ id: string; replyTo: string | null; name?: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  // 触底加载更多
  useEffect(() => {
    const el = feedEndRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        loadMore();
      }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  const handlePickImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const arr = Array.from(files).slice(0, 9 - picked.length);
      for (const f of arr) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const ext = (f.name.split('.').pop() || 'png').toLowerCase();
        const res = await fetch('/api/moments/image/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, ext }),
        });
        if (!res.ok) throw new Error('上传失败');
        const data = await res.json();
        setPicked(prev => [...prev, data.imagePath]);
        setPickedPreviews(prev => [...prev, URL.createObjectURL(f)]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handlePublish = async () => {
    const content = text.trim();
    if (!content && picked.length === 0) return;
    setPublishing(true);
    try {
      await publish({ content: content || undefined, images: picked });
      setText('');
      setPicked([]);
      setPickedPreviews([]);
    } catch (e) {
      console.error(e);
    } finally {
      setPublishing(false);
    }
  };

  const submitComment = async () => {
    if (!commentFor || !commentText.trim()) return;
    try {
      await comment(commentFor.id, commentText.trim(), commentFor.replyTo);
      setCommentText('');
      setCommentFor(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      {/* 顶部栏 */}
      <header
        className="h-14 flex items-center gap-3 px-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--td-component-stroke)', backgroundColor: 'var(--td-bg-color-page)' }}
      >
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }} title="返回聊天">
          <ArrowLeft />
        </button>
        <span className="font-medium" style={{ color: 'var(--td-text-color-primary)' }}>朋友圈</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto w-full px-4 py-4 space-y-4">
          {/* 发布框 */}
          <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="这一刻的想法…"
              rows={3}
              maxLength={2000}
              className="w-full px-3 py-2 rounded-lg outline-none resize-none text-sm"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
            />
            {/* 图片选择 */}
            <div className="flex flex-wrap gap-2">
              {pickedPreviews.map((src, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => { setPicked(p => p.filter((_, j) => j !== i)); setPickedPreviews(p => p.filter((_, j) => j !== i)); }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {picked.length < 9 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 rounded-lg flex flex-col items-center justify-center gap-1 border border-dashed"
                  style={{ borderColor: 'var(--td-component-stroke)', color: 'var(--td-text-color-placeholder)' }}
                >
                  <ImagePlus size={20} />
                  <span className="text-[11px]">{uploading ? '上传中' : '图片'}</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={e => handlePickImages(e.target.files)}
              />
            </div>
            <div className="flex justify-end">
              <Button theme="primary" loading={publishing} disabled={(!text.trim() && picked.length === 0) || publishing} onClick={handlePublish}>
                发表
              </Button>
            </div>
          </div>

          {/* 时间线 */}
          {loading ? (
            <div className="flex justify-center py-10"><Loading size="medium" /></div>
          ) : moments.length === 0 ? (
            <div className="text-center text-sm py-10" style={{ color: 'var(--td-text-color-placeholder)' }}>还没有动态，发表第一条吧</div>
          ) : (
            moments.map(m => (
              <MomentCard
                key={m.id}
                moment={m}
                meId={meId}
                onToggleLike={() => toggleLike(m.id)}
                onDelete={() => remove(m.id)}
                onStartComment={(replyTo, name) => setCommentFor({ id: m.id, replyTo: replyTo ?? null, name })}
                commentFor={commentFor?.id === m.id ? commentFor : null}
                commentText={commentFor?.id === m.id ? commentText : ''}
                onCommentTextChange={t => setCommentText(t)}
                onSubmitComment={submitComment}
                onCancelComment={() => { setCommentFor(null); setCommentText(''); }}
              />
            ))
          )}

          {loadingMore && (
            <div className="flex justify-center py-4"><Loading size="small" /><span className="ml-2 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>加载中…</span></div>
          )}
          {!hasMore && moments.length > 0 && (
            <div className="text-center text-xs py-4" style={{ color: 'var(--td-text-color-placeholder)' }}>没有更多了</div>
          )}
          <div ref={feedEndRef} className="h-4" />
        </div>
      </div>
    </div>
  );
}

function MomentCard({
  moment, meId, onToggleLike, onDelete, onStartComment, commentFor, commentText, onCommentTextChange, onSubmitComment, onCancelComment,
}: {
  moment: Moment;
  meId: string;
  onToggleLike: () => void;
  onDelete: () => void;
  onStartComment: (replyTo: string | null, name?: string) => void;
  commentFor: { id: string; replyTo: string | null; name?: string } | null;
  commentText: string;
  onCommentTextChange: (t: string) => void;
  onSubmitComment: () => void;
  onCancelComment: () => void;
}) {
  const gridCols = moment.images.length === 1 ? 'grid-cols-1' : moment.images.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      <div className="flex items-start gap-3">
        <Avatar text={moment.authorAvatarText} color={moment.authorAvatarColor} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--td-brand-color)' }}>{moment.authorName}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>{relTime(moment.createdAt)}</div>
        </div>
        {moment.authorId === meId && (
          <button onClick={onDelete} className="p-1 rounded hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="删除动态">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {moment.content && (
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--td-text-color-primary)' }}>{moment.content}</div>
      )}

      {moment.images.length > 0 && (
        <div className={`grid ${gridCols} gap-1.5 max-w-md`}>
          {moment.images.map((img, i) => (
            <div key={i} className="rounded-lg overflow-hidden bg-[var(--td-bg-color-component)] aspect-square">
              <img src={`/api/moments/image/${img}`} alt="" className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex items-center gap-4 pt-1">
        <button onClick={onToggleLike} className="flex items-center gap-1 text-sm" style={{ color: moment.likedByMe ? '#e34d59' : 'var(--td-text-color-secondary)' }}>
          <Heart size={16} fill={moment.likedByMe ? '#e34d59' : 'none'} />
          {moment.likes.length > 0 ? '赞' : '点赞'}
        </button>
        <button onClick={() => onStartComment(null)} className="flex items-center gap-1 text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          <MessageCircle size={16} /> 评论
        </button>
      </div>

      {(moment.likes.length > 0 || moment.comments.length > 0) && (
        <div className="rounded-lg p-3 space-y-2 text-sm" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
          {moment.likes.length > 0 && (
            <div className="flex items-start gap-1.5">
              <Heart size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#e34d59' }} />
              <span style={{ color: 'var(--td-text-color-secondary)' }}>{likeSummary(moment)}</span>
            </div>
          )}
          {moment.comments.map(c => (
            <CommentItem key={c.id} comment={c} onReply={() => onStartComment(c.authorId, c.authorName)} />
          ))}
        </div>
      )}

      {commentFor && (
        <div className="flex items-center gap-2">
          {commentFor.replyTo && (
            <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
              回复 {commentFor.name}
            </span>
          )}
          <input
            autoFocus
            value={commentText}
            onChange={e => onCommentTextChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSubmitComment(); }}
            placeholder="说点什么…"
            className="flex-1 px-3 py-1.5 rounded-lg outline-none text-sm"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
          />
          <Button size="small" icon={<Send size={14} />} onClick={onSubmitComment} disabled={!commentText.trim()}>发送</Button>
          <Button size="small" variant="text" onClick={onCancelComment}>取消</Button>
        </div>
      )}
    </div>
  );
}

function CommentItem({ comment, onReply }: { comment: MomentComment; onReply: () => void }) {
  return (
    <div className="flex items-start gap-1.5 text-sm">
      <span className="font-medium" style={{ color: 'var(--td-brand-color)' }}>{comment.authorName}</span>
      {comment.replyTo && <span style={{ color: 'var(--td-text-color-placeholder)' }}>回复</span>}
      {comment.replyTo && <span className="font-medium" style={{ color: 'var(--td-brand-color)' }}>{comment.replyTo === 'me' ? '我' : comment.replyTo}</span>}
      <span style={{ color: 'var(--td-text-color-secondary)' }}>：{comment.content}</span>
      <button onClick={onReply} className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--td-text-color-placeholder)' }}>回复</button>
    </div>
  );
}
