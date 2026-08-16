import { useState } from 'react';
import { Button, Tooltip, Input, Dialog } from 'tdesign-react';
import { MessageCircle, Users, Plus, Trash2, Settings, Moon, Sun, Search, UserPlus, Bell, BellOff, Pencil } from 'lucide-react';
import { Contact, Conversation } from '../types';
import { NotifState } from '../lib/notifications';
import { AddContactDialog } from './AddContactDialog';
import { EditContactDialog } from './EditContactDialog';

interface SidebarProps {
  conversations: Conversation[];
  contacts: Contact[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onSelectContact: (contactId: string) => void;
  onCreateGroup: () => void;
  onDeleteConversation: (id: string) => void;
  onAddContact: (name: string, color?: string) => Promise<unknown>;
  onDeleteContact: (id: string) => void;
  onEditContact: (id: string, updates: { name?: string; avatarText?: string; avatarColor?: string }) => Promise<unknown> | void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  theme: string;
  onToggleTheme: () => void;
  onEnableNotifications?: () => void;
  notifState?: NotifState;
}

function Avatar({ text, color, size = 40 }: { text?: string | null; color?: string | null; size?: number }) {
  return (
    <div
      className="flex-shrink-0 rounded-lg flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color || '#0052d9', fontSize: size * 0.4 }}
    >
      {text || '?'}
    </div>
  );
}

export function Sidebar({
  conversations, contacts, currentConversationId, onSelectConversation,
  onSelectContact, onCreateGroup, onDeleteConversation, onAddContact, onDeleteContact, onEditContact, onOpenSettings, onOpenSearch, theme, onToggleTheme,
  onEnableNotifications, notifState = 'default',
}: SidebarProps) {
  const [tab, setTab] = useState<'chat' | 'contacts'>('chat');
  const [search, setSearch] = useState('');
  const [addDialog, setAddDialog] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [delTarget, setDelTarget] = useState<Contact | null>(null);
  const humans = contacts.filter(c => !c.isAgent && c.id !== 'me');
  const agents = contacts.filter(c => c.isAgent);
  const q = search.trim().toLowerCase();
  const filteredHumans = q ? humans.filter(c => c.name.toLowerCase().includes(q)) : humans;
  const meId = contacts.find(c => c.id === 'me')?.id || 'me';

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <aside
      className="flex flex-col flex-shrink-0 h-full"
      style={{ width: 300, backgroundColor: 'var(--td-bg-color-container)', borderRight: '1px solid var(--td-component-stroke)' }}
    >
      {/* 顶部 Logo + 主题 */}
      <div className="h-14 px-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#07c160' }}>
            <span className="text-white text-sm font-bold">星</span>
          </div>
          <span className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>星火聊天</span>
        </div>
        <button onClick={onOpenSearch} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }} title="搜索聊天记录">
          <Search />
        </button>
        <button onClick={onToggleTheme} className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
        <Tooltip content={notifState === 'granted' ? '桌面通知已开启' : notifState === 'denied' ? '通知被浏览器拦截，请在站点设置中允许' : notifState === 'unsupported' ? '当前环境不支持桌面通知' : '开启被 @ 时的桌面通知'}>
          <button
            onClick={onEnableNotifications}
            disabled={notifState === 'unsupported'}
            className="p-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)] disabled:opacity-40"
            style={{ color: notifState === 'granted' ? '#07c160' : 'var(--td-text-color-secondary)' }}
          >
            {notifState === 'granted' ? <Bell /> : <BellOff />}
          </button>
        </Tooltip>
      </div>

      {/* Tab 切换 + 新建 */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          onClick={() => setTab('chat')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor: tab === 'chat' ? 'var(--td-brand-color-light)' : 'transparent',
            color: tab === 'chat' ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
          }}
        >
          <MessageCircle /> 聊天
        </button>
        <button
          onClick={() => setTab('contacts')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            backgroundColor: tab === 'contacts' ? 'var(--td-brand-color-light)' : 'transparent',
            color: tab === 'contacts' ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
          }}
        >
          <Users /> 通讯录
        </button>
        <Tooltip content="发起群聊">
          <button onClick={onCreateGroup} className="p-2 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
            <Plus />
          </button>
        </Tooltip>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {tab === 'chat' && (
          conversations.length === 0 ? (
            <div className="text-center text-sm mt-10" style={{ color: 'var(--td-text-color-placeholder)' }}>
              还没有会话，去通讯录找个朋友聊聊吧
            </div>
          ) : conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: conv.id === currentConversationId ? 'var(--td-brand-color-light)' : 'transparent',
              }}
              onMouseEnter={e => { if (conv.id !== currentConversationId) e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)'; }}
              onMouseLeave={e => { if (conv.id !== currentConversationId) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div className="relative flex-shrink-0">
                <Avatar text={conv.avatarText} color={conv.avatarColor} />
                {conv.unreadCount ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-white text-[11px] font-medium" style={{ backgroundColor: '#fa5151' }}>
                    {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                  </span>
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{conv.title}</span>
                  <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--td-text-color-placeholder)' }}>{fmtTime(conv.lastMessage?.createdAt)}</span>
                </div>
                <div className="truncate text-xs mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
                  {conv.lastMessage?.meta?.mentions?.includes(meId) && (
                    <span className="text-[11px] px-1 rounded mr-1" style={{ color: '#fff', backgroundColor: '#e34d59' }}>@我</span>
                  )}
                  {conv.lastMessage ? (conv.lastMessage.senderId === 'me' ? '我: ' : '') + conv.lastMessage.content : '暂无消息'}
                </div>
              </div>
                <Tooltip content="删除会话">
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                  style={{ color: 'var(--td-text-color-secondary)' }}
                >
                  <Trash2 />
                </button>
              </Tooltip>
            </div>
          ))
        )}

        {tab === 'contacts' && (
          <>
            <div className="px-2 pb-2">
              <Input
                value={search}
                onChange={e => setSearch(e as string)}
                placeholder="搜索联系人"
                prefixIcon={<Search size={14} />}
                clearable
              />
            </div>
            {agents.length > 0 && (
              <div className="px-3 pt-2 pb-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>智能助手</div>
            )}
            {agents.map(c => (
              <div key={c.id} onClick={() => onSelectContact(c.id)} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]">
                <Avatar text={c.avatarText} color={c.avatarColor} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{c.name}</div>
                  <div className="truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>AI 助手 · 可聊天 / 远程协助</div>
                </div>
                <Tooltip content="编辑助手资料">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); setEditContact(c); }}
                    style={{ color: 'var(--td-text-color-secondary)' }}
                  >
                    <Pencil size={15} />
                  </button>
                </Tooltip>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 pt-3 pb-1">
              <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>联系人{q ? `（${filteredHumans.length}）` : ''}</span>
              <Tooltip content="添加联系人">
                <button onClick={() => setAddDialog(true)} className="p-1 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
                  <UserPlus size={15} />
                </button>
              </Tooltip>
            </div>
            {filteredHumans.length === 0 && (
              <div className="text-center text-xs py-4" style={{ color: 'var(--td-text-color-placeholder)' }}>
                {q ? '没有匹配的联系人' : '还没有联系人，点右上角 + 添加'}
              </div>
            )}
            {filteredHumans.map(c => (
              <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]" onClick={() => onSelectContact(c.id)}>
                <Avatar text={c.avatarText} color={c.avatarColor} />
                <div className="truncate text-sm font-medium flex-1" style={{ color: 'var(--td-text-color-primary)' }}>{c.name}</div>
                <Tooltip content="编辑联系人">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); setEditContact(c); }}
                    style={{ color: 'var(--td-text-color-secondary)' }}
                  >
                    <Pencil size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="删除联系人">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); setDelTarget(c); }}
                    style={{ color: 'var(--td-text-color-secondary)' }}
                  >
                    <Trash2 size={15} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 底部设置 */}
      <div className="p-3 border-t flex-shrink-0" style={{ borderColor: 'var(--td-component-stroke)' }}>
        <Button icon={<Settings />} onClick={onOpenSettings} block variant="text">{theme === 'dark' ? '设置' : '设置'}</Button>
      </div>

      <AddContactDialog visible={addDialog} onClose={() => setAddDialog(false)} onAdd={onAddContact} />

      <EditContactDialog
        visible={!!editContact}
        contact={editContact}
        onClose={() => setEditContact(null)}
        onSave={async (updates) => { if (editContact) await onEditContact(editContact.id, updates); }}
      />

      <Dialog
        visible={!!delTarget}
        onClose={() => setDelTarget(null)}
        header="删除联系人"
        onConfirm={async () => { if (delTarget) { await onDeleteContact(delTarget.id); setDelTarget(null); } }}
        confirmBtn={{ content: '删除', theme: 'danger' }}
        cancelBtn="取消"
        width={400}
      >
        <p className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>
          确定删除「{delTarget?.name}」吗？该联系人会从群聊成员中移除，但与 TA 的聊天记录会保留（成为游离会话）。
        </p>
      </Dialog>
    </aside>
  );
}
