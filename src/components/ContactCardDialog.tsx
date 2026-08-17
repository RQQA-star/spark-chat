import { useState, useEffect } from 'react';
import { Dialog, Input, Button } from 'tdesign-react';
import { Star, MessageCircle, Bot } from 'lucide-react';
import { Contact } from '../types';

interface ContactCardDialogProps {
  visible: boolean;
  contact: Contact | null;
  meId: string;
  onClose: () => void;
  onSaveRemark: (id: string, remark: string) => Promise<unknown> | void;
  onToggleStar: (id: string, starred: boolean) => Promise<unknown> | void;
  onMessage: (id: string) => void;
}

function CardAvatar({ text, color, size = 72 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#888', fontSize: size * 0.38 }}
    >
      {text || '?'}
    </div>
  );
}

export function ContactCardDialog({
  visible, contact, meId, onClose, onSaveRemark, onToggleStar, onMessage,
}: ContactCardDialogProps) {
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && contact) {
      setRemark(contact.remark || '');
      setBusy(false);
    }
  }, [visible, contact]);

  const isMe = contact?.id === meId;
  const starred = !!contact?.starred;

  const handleStar = async () => {
    if (!contact) return;
    await onToggleStar(contact.id, !starred);
  };

  const handleSaveRemark = async () => {
    if (!contact) return;
    setBusy(true);
    try {
      await onSaveRemark(contact.id, remark.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header={null}
      footer={null}
      width={380}
    >
      {contact && (
        <div className="flex flex-col items-center pt-4 pb-2">
          <CardAvatar text={contact.avatarText} color={contact.avatarColor} />
          <div className="mt-3 text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--td-text-color-primary)' }}>
            {contact.name}
            {contact.isAgent && <Bot size={16} style={{ color: 'var(--td-brand-color)' }} />}
          </div>
          {contact.remark && (
            <div className="mt-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>备注：{contact.remark}</div>
          )}
          {isMe && (
            <div className="mt-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>这是你自己</div>
          )}

          {/* 备注编辑（非本人、非 AI 也允许；AI 允许备注） */}
          {!isMe && (
            <div className="w-full mt-4">
              <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>设置备注</div>
              <Input
                value={remark}
                onChange={e => setRemark(e as string)}
                placeholder="添加备注名"
                maxlength={200}
                onEnter={handleSaveRemark}
              />
            </div>
          )}

          <div className="flex gap-2 w-full mt-5">
            {!isMe && (
              <Button
                variant="outline"
                icon={starred ? <Star size={16} fill="#faad14" color="#faad14" /> : <Star size={16} />}
                onClick={handleStar}
                disabled={busy}
                block
              >
                {starred ? '已星标' : '星标'}
              </Button>
            )}
            {!isMe && (
              <Button
                theme="primary"
                icon={<MessageCircle size={16} />}
                onClick={() => { onMessage(contact.id); onClose(); }}
                block
              >
                发消息
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
