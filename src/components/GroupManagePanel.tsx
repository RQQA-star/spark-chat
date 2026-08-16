import { useState, useEffect, useMemo } from 'react';
import { Dialog, Input, Button } from 'tdesign-react';
import { UserPlus, UserMinus, Check, QrCode, Download } from 'lucide-react';
import { Conversation, Contact } from '../types';

interface GroupManagePanelProps {
  visible: boolean;
  conversation: Conversation;
  contacts: Contact[];
  meId: string;
  onClose: () => void;
  onAddMember: (convId: string, contactId: string) => Promise<unknown>;
  onRemoveMember: (convId: string, contactId: string) => Promise<unknown>;
  onRename: (convId: string, title: string) => Promise<unknown>;
  onSetAnnouncement: (convId: string, text: string) => Promise<unknown>;
  onReloadMessages: () => void;
}

function MemberAvatar({ text, color, size = 36 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#888', fontSize: size * 0.4 }}
    >
      {text || '?'}
    </div>
  );
}

export function GroupManagePanel({
  visible, conversation, contacts, meId, onClose,
  onAddMember, onRemoveMember, onRename, onSetAnnouncement, onReloadMessages,
}: GroupManagePanelProps) {
  const [title, setTitle] = useState(conversation.title || '');
  const [announcement, setAnnouncement] = useState(conversation.announcement || '');
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<{ qrDataUrl: string; payload: string; title: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  useEffect(() => {
    if (visible) { setTitle(conversation.title || ''); setAnnouncement(conversation.announcement || ''); }
  }, [visible, conversation.title, conversation.announcement]);

  const memberMap = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) map.set(c.id, c);
    return map;
  }, [contacts]);

  const members = conversation.participantIds
    .map(id => memberMap.get(id))
    .filter((c): c is Contact => !!c);

  const candidates = contacts.filter(
    c => c.id !== meId && !conversation.participantIds.includes(c.id)
  );

  const postSystem = async (text: string) => {
    try {
      await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: meId, msgType: 'system', content: text }),
      });
    } catch (e) {
      console.error('系统消息写入失败', e);
    }
  };

  const handleAdd = async (contactId: string) => {
    setBusy(true);
    try {
      const name = memberMap.get(contactId)?.name || '新成员';
      await onAddMember(conversation.id, contactId);
      await postSystem(`你邀请 ${name} 加入了群聊`);
      onReloadMessages();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (contactId: string) => {
    if (contactId === meId) return;
    setBusy(true);
    try {
      const name = memberMap.get(contactId)?.name || '成员';
      const res: any = await onRemoveMember(conversation.id, contactId);
      if (res?.success === false) return; // 后端拒绝（如群已空）
      await postSystem(`${name} 退出了群聊`);
      onReloadMessages();
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    const next = title.trim();
    if (!next || next === conversation.title) return;
    setBusy(true);
    try {
      await onRename(conversation.id, next);
      await postSystem(`群名称修改为「${next}」`);
      onReloadMessages();
    } finally {
      setBusy(false);
    }
  };

  const handleSetAnnouncement = async () => {
    const next = announcement.trim();
    if (next === (conversation.announcement || '').trim()) return;
    setBusy(true);
    try {
      await onSetAnnouncement(conversation.id, next);
      if (next) await postSystem(`群公告已更新`);
      onReloadMessages();
    } finally {
      setBusy(false);
    }
  };

  const openQr = async () => {
    setQrOpen(true);
    setQrLoading(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/qr`);
      if (!res.ok) throw new Error('获取二维码失败');
      const data = await res.json();
      setQrData({ qrDataUrl: data.qrDataUrl, payload: data.payload, title: data.title || conversation.title || '群聊' });
    } catch (e) {
      console.error(e);
    } finally {
      setQrLoading(false);
    }
  };

  return (
    <>
    <Dialog
      visible={visible}
      onClose={onClose}
      header="群聊管理"
      footer={null}
      width={440}
    >
      <div className="space-y-5">
        {/* 群名称 + 群二维码 */}
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>群名称</div>
          <div className="flex gap-2">
            <Input
              value={title}
              onChange={e => setTitle(e as string)}
              placeholder="给群起个名字"
              onEnter={handleRename}
            />
            <Button
              icon={<Check />}
              onClick={handleRename}
              disabled={busy || !title.trim() || title.trim() === conversation.title}
            >
              保存
            </Button>
          </div>
          <Button
            className="mt-2"
            size="small"
            variant="outline"
            icon={<QrCode size={15} />}
            onClick={openQr}
          >
            群二维码（邀请）
          </Button>
        </div>

        {/* 群公告 */}
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>群公告</div>
          <div className="flex flex-col gap-2">
            <textarea
              value={announcement}
              onChange={e => setAnnouncement(e.target.value)}
              placeholder="发布群公告，群成员会在会话顶部看到"
              rows={3}
              maxLength={1000}
              className="w-full px-3 py-2 rounded-lg outline-none resize-none text-sm"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
            />
            <div className="flex justify-end">
              <Button
                size="small"
                icon={<Check />}
                onClick={handleSetAnnouncement}
                disabled={busy || announcement.trim() === (conversation.announcement || '').trim()}
              >
                发布
              </Button>
            </div>
          </div>
        </div>

        {/* 成员列表 */}
        <div>
          <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>
            群成员（{members.length}）
          </div>
          <div className="max-h-52 overflow-y-auto rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
            {members.map(m => {
              const isMe = m.id === meId;
              return (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  <MemberAvatar text={m.avatarText} color={m.avatarColor} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                      {m.name}{m.isAgent ? '（AI）' : ''}{isMe ? '（我）' : ''}
                    </div>
                  </div>
                  {!isMe && (
                    <Button
                      size="small"
                      variant="text"
                      theme="danger"
                      icon={<UserMinus />}
                      disabled={busy}
                      onClick={() => handleRemove(m.id)}
                    >
                      移除
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 添加成员 */}
        {candidates.length > 0 && (
          <div>
            <div className="text-sm mb-2" style={{ color: 'var(--td-text-color-secondary)' }}>添加成员</div>
            <div className="max-h-44 overflow-y-auto rounded-lg space-y-1" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
              {candidates.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <MemberAvatar text={c.avatarText} color={c.avatarColor} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                      {c.name}{c.isAgent ? '（AI）' : ''}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="outline"
                    icon={<UserPlus />}
                    disabled={busy}
                    onClick={() => handleAdd(c.id)}
                  >
                    添加
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button theme="default" onClick={onClose}>完成</Button>
        </div>
      </div>
    </Dialog>

    {/* 群二维码弹窗 */}
    <Dialog
      visible={qrOpen}
      onClose={() => setQrOpen(false)}
      header="群二维码"
      footer={null}
      width={320}
    >
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>{qrData?.title || conversation.title}</div>
        {qrLoading ? (
          <div className="w-[240px] h-[240px] flex items-center justify-center" style={{ color: 'var(--td-text-color-placeholder)' }}>生成中…</div>
        ) : qrData ? (
          <img src={qrData.qrDataUrl} alt="群二维码" className="w-[240px] h-[240px]" />
        ) : (
          <div className="w-[240px] h-[240px] flex items-center justify-center" style={{ color: 'var(--td-text-color-placeholder)' }}>生成失败</div>
        )}
        <div className="text-xs text-center" style={{ color: 'var(--td-text-color-placeholder)' }}>
          扫码可复制本群邀请信息（本地演示）
        </div>
        {qrData && (
          <Button
            size="small"
            icon={<Download size={15} />}
            onClick={() => {
              const a = document.createElement('a');
              a.href = qrData.qrDataUrl;
              a.download = `群二维码_${qrData.title || 'group'}.png`;
              a.click();
            }}
          >
            下载二维码
          </Button>
        )}
      </div>
    </Dialog>
    </>
  );
}
