import { useState, useEffect } from 'react';
import { Dialog, Input, Button } from 'tdesign-react';

interface AddContactDialogProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (name: string, color?: string) => Promise<unknown>;
}

const PALETTE = ['#ff9c00', '#7c5cff', '#e34d59', '#2ba471', '#0052d9', '#ed7b2f', '#0594fa', '#834ec2'];

export function AddContactDialog({ visible, onClose, onAdd }: AddContactDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setName(''); setColor(PALETTE[0]); setBusy(false); }
  }, [visible]);

  const handleAdd = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(name.trim(), color);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header="添加联系人"
      onConfirm={handleAdd}
      confirmBtn={{ content: '添加', disabled: !name.trim() || busy }}
      cancelBtn="取消"
      width={400}
    >
      <div className="space-y-4 py-1">
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>名称</div>
          <Input value={name} onChange={e => setName(e as string)} placeholder="联系人昵称" onEnter={handleAdd} autofocus />
        </div>
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>头像颜色</div>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map(c => (
              <button
                key={c}
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
      </div>
    </Dialog>
  );
}
