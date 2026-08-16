import { useState, useEffect } from 'react';
import { Dialog, Input } from 'tdesign-react';
import { Contact } from '../types';
import { Star } from 'lucide-react';

interface EditContactDialogProps {
  visible: boolean;
  contact: Contact | null;
  onClose: () => void;
  onSave: (updates: { name?: string; avatarText?: string; avatarColor?: string; remark?: string; starred?: boolean }) => Promise<unknown> | void;
}

const PALETTE = ['#ff9c00', '#7c5cff', '#e34d59', '#2ba471', '#0052d9', '#ed7b2f', '#0594fa', '#834ec2'];

export function EditContactDialog({ visible, contact, onClose, onSave }: EditContactDialogProps) {
  const [name, setName] = useState('');
  const [avatarText, setAvatarText] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [remark, setRemark] = useState('');
  const [starred, setStarred] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && contact) {
      setName(contact.name || '');
      setAvatarText(contact.avatarText || '');
      setColor(contact.avatarColor || PALETTE[0]);
      setRemark(contact.remark || '');
      setStarred(!!contact.starred);
      setBusy(false);
    }
  }, [visible, contact]);

  const handleSave = async () => {
    if (!name.trim() || busy || !contact) return;
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        avatarText: avatarText.trim() || name.trim().slice(0, 1).toUpperCase(),
        avatarColor: color,
        remark: remark.trim(),
        starred,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header={`编辑「${contact?.name || ''}」`}
      onConfirm={handleSave}
      confirmBtn={{ content: '保存', disabled: !name.trim() || busy }}
      cancelBtn="取消"
      width={400}
    >
      <div className="space-y-4 py-1">
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>名称</div>
          <Input value={name} onChange={e => setName(e as string)} placeholder="联系人昵称" onEnter={handleSave} autofocus />
        </div>
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>头像文字（留空取名称首字，最多 2 字）</div>
          <Input value={avatarText} onChange={e => setAvatarText(e as string)} placeholder="可选" maxlength={2} />
        </div>
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>头像颜色</div>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="w-8 h-8 rounded-lg transition-transform"
                style={{
                  backgroundColor: c,
                  outline: color === c ? '2px solid var(--td-brand-color)' : 'none',
                  outlineOffset: 2,
                  transform: color === c ? 'scale(1.08)' : 'none',
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>备注</div>
          <Input
            value={remark}
            onChange={e => setRemark(e as string)}
            placeholder="设置备注名（仅自己可见）"
            maxlength={200}
          />
        </div>
        <button
          type="button"
          onClick={() => setStarred(v => !v)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors"
          style={{
            backgroundColor: starred ? 'rgba(250,173,20,0.12)' : 'var(--td-bg-color-component)',
            color: starred ? '#faad14' : 'var(--td-text-color-secondary)',
          }}
        >
          <Star size={16} fill={starred ? '#faad14' : 'none'} />
          {starred ? '已设为星标朋友' : '设为星标朋友'}
        </button>
      </div>
    </Dialog>
  );
}
