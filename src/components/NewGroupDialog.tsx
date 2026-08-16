import { useState, useEffect } from 'react';
import { Dialog, Input, Checkbox } from 'tdesign-react';
import { Contact } from '../types';

interface NewGroupDialogProps {
  visible: boolean;
  contacts: Contact[];
  onClose: () => void;
  onCreate: (input: { type: 'group'; participantIds: string[]; title?: string; avatarText?: string; avatarColor?: string }) => void;
}

export function NewGroupDialog({ visible, contacts, onClose, onCreate }: NewGroupDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (visible) { setSelected([]); setTitle(''); }
  }, [visible]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = () => {
    if (selected.length === 0) return;
    onCreate({
      type: 'group',
      participantIds: selected,
      title: title.trim() || `群聊(${selected.length + 1}人)`,
      avatarText: '群',
      avatarColor: '#7c5cff',
    });
    onClose();
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header="发起群聊"
      onConfirm={handleCreate}
      confirmBtn={{ content: '创建', disabled: selected.length === 0 }}
      cancelBtn="取消"
      width={420}
    >
      <div className="space-y-3">
        <Input value={title} onChange={e => setTitle(e as string)} placeholder="群名称（可选）" />
        <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>选择成员（含「星火助手」可让 AI 进群）：</div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {contacts.filter(c => c.id !== 'me').map(c => (
            <label key={c.id} className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]">
              <Checkbox checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-semibold text-sm"
                style={{ backgroundColor: c.avatarColor || '#888' }}
              >
                {c.avatarText}
              </div>
              <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>
                {c.name}{c.isAgent ? '（AI）' : ''}
              </span>
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
