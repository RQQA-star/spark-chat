import { useState } from 'react';
import { Dialog, Input } from 'tdesign-react';
import { Conversation } from '../types';

interface ForwardDialogProps {
  visible: boolean;
  conversations: Conversation[];
  currentConversationId: string | null;
  onClose: () => void;
  onPick: (conversationId: string) => void;
}

function Avatar({ text, color, size = 36 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#0052d9', fontSize: size * 0.4 }}
    >
      {text || '?'}
    </div>
  );
}

export function ForwardDialog({ visible, conversations, currentConversationId, onClose, onPick }: ForwardDialogProps) {
  const [kw, setKw] = useState('');
  const list = conversations
    .filter(c => c.id !== currentConversationId)
    .filter(c => (c.title || '').toLowerCase().includes(kw.toLowerCase()));

  return (
    <Dialog visible={visible} onClose={onClose} header="转发到" width={480} footer={null}>
      <Input value={kw} onChange={e => setKw(e as string)} placeholder="搜索会话" style={{ marginBottom: 8 }} />
      <div className="max-h-80 overflow-y-auto -mr-2 pr-2">
        {list.length === 0 && (
          <div className="text-center text-sm py-8" style={{ color: 'var(--td-text-color-placeholder)' }}>没有可转发的会话</div>
        )}
        {list.map(c => (
          <div
            key={c.id}
            onClick={() => onPick(c.id)}
            className="flex items-center gap-3 px-2 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]"
          >
            <Avatar text={c.avatarText} color={c.avatarColor} />
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{c.title}</div>
              <div className="truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>
                {c.type === 'group' ? '群聊' : '单聊'}{c.lastMessage ? ' · ' + (c.lastMessage.content || '') : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
