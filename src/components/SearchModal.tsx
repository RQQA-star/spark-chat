import { useState, useEffect, useRef } from 'react';
import { Dialog, Input, Loading } from 'tdesign-react';
import { Search } from 'lucide-react';

interface SearchResultItem {
  id: string;
  conversationId: string;
  conversationTitle: string;
  conversationType: string;
  senderId: string;
  senderName: string;
  msgType: string;
  content: string | null;
  createdAt: string;
}

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (conversationId: string, messageId: string) => void;
}

function highlight(text: string, kw: string) {
  if (!kw) return text;
  const idx = text.toLowerCase().indexOf(kw.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#e34d59', fontWeight: 600 }}>{text.slice(idx, idx + kw.length)}</span>
      {text.slice(idx + kw.length)}
    </>
  );
}

export function SearchModal({ visible, onClose, onSelect }: SearchModalProps) {
  const [kw, setKw] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) { setKw(''); setResults([]); return; }
  }, [visible]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const q = kw.trim();
    if (q.length < 1) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/messages/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [kw]);

  return (
    <Dialog visible={visible} onClose={onClose} header="搜索聊天记录" width={560} footer={null}>
      <div className="relative mb-2">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--td-text-color-placeholder)' }} />
        <Input
          autofocus
          value={kw}
          onChange={e => setKw(e as string)}
          placeholder="输入关键词，搜索全部会话的消息"
          style={{ paddingLeft: 32 }}
        />
      </div>

      <div className="max-h-96 overflow-y-auto -mr-2 pr-2">
        {kw.trim() && loading && (
          <div data-testid="search-loading" className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: 'var(--td-text-color-placeholder)' }}>
            <Loading size="small" /> 搜索中…
          </div>
        )}
        {kw.trim() && !loading && results.length === 0 && (
          <div className="text-center text-sm py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>没有找到相关消息</div>
        )}
        {!kw.trim() && (
          <div className="text-center text-sm py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>输入关键词开始搜索</div>
        )}
        {results.map(r => (
          <div
            key={r.id}
            onClick={() => onSelect(r.conversationId, r.id)}
            className="flex flex-col gap-0.5 px-2 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)] border-b"
            style={{ borderColor: 'var(--td-component-stroke)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                {highlight(r.conversationTitle, kw)}
              </span>
              <span className="text-[11px] px-1 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-placeholder)' }}>
                {r.conversationType === 'group' ? '群聊' : '单聊'}
              </span>
              <span className="text-[11px] ml-auto" style={{ color: 'var(--td-text-color-placeholder)' }}>
                {new Date(r.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--td-text-color-secondary)' }}>
              <b>{r.senderName}</b>：{highlight(r.content || '', kw)}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
