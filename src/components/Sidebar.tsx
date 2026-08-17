import { useState } from 'react';
import { Tooltip, Input, Dialog } from 'tdesign-react';
import { MessageCircle, Users, Plus, Trash2, Settings, Moon, Sun, Search, UserPlus, Bell, BellOff, Pencil, Pin, Star, CheckCheck, Monitor } from 'lucide-react';
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
  onEditContact: (id: string, updates: { name?: string; avatarText?: string; avatarColor?: string; remark?: string; starred?: boolean }) => Promise<unknown> | void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  theme: string;
  onToggleTheme: () => void;
  onEnableNotifications?: () => void;
  notifState?: NotifState;
  onTogglePin?: (id: string, pinned: boolean) => void;
  onToggleMute?: (id: string, muted: boolean) => void;
  onToggleStar?: (id: string, starred: boolean) => void;
  onOpenContactCard?: (id: string) => void;
  onMarkAllRead?: () => void;
  onOpenFavorites?: () => void;
  onOpenRemoteAssist?: () => void;
  activeView?: 'chat' | 'moments';
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

function RailNav({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors"
      style={{
        backgroundColor: active ? 'var(--td-brand-color-light)' : 'transparent',
        color: active ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
      }}
    >
      {icon}
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}

function RailIcon({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--td-bg-color-component-hover)] disabled:opacity-40"
      style={{ color: 'var(--td-text-color-secondary)' }}
    >
      {children}
    </button>
  );
}

export function Sidebar({
  conversations, contacts, currentConversationId, onSelectConversation,
  onSelectContact, onCreateGroup, onDeleteConversation, onAddContact, onDeleteContact, onEditContact, onOpenSettings, onOpenSearch, theme, onToggleTheme,
  onEnableNotifications, notifState = 'default', onTogglePin, onToggleMute,
  onToggleStar, onOpenContactCard, onMarkAllRead, onOpenFavorites, onOpenRemoteAssist, activeView,
}: SidebarProps) {
  const [tab, setTab] = useState<'chat' | 'contacts'>('chat');
  const [search, setSearch] = useState('');
  const [addDialog, setAddDialog] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [delTarget, setDelTarget] = useState<Contact | null>(null);
  const humans = contacts.filter(c => !c.isAgent && c.id !== 'me');
  const totalUnread = conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
  const agents = contacts.filter(c => c.isAgent);
  const starredContacts = contacts.filter(c => c.starred && !c.isAgent && c.id !== 'me');
  const meContact = contacts.find(c => c.id === 'me');
  const q = search.trim().toLowerCase();
  const filteredHumans = q ? humans.filter(c => c.name.toLowerCase().includes(q)) : humans;
  const filteredConvs = q
    ? conversations.filter(c => (c.title || '').toLowerCase().includes(q) || (c.lastMessage?.content || '').toLowerCase().includes(q))
    : conversations;
  const meId = contacts.find(c => c.id === 'me')?.id || 'me';

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <aside className="flex h-full flex-shrink-0" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      {/* 左侧导航栏 72px（微信风竖排导航） */}
      <nav
        className="flex flex-col items-center w-[72px] h-full py-3 flex-shrink-0"
        style={{ backgroundColor: 'var(--td-bg-color-page)', borderRight: '1px solid var(--td-component-stroke)' }}
      >
        <Avatar text={meContact?.avatarText || '我'} color={meContact?.avatarColor || '#07c160'} size={40} />
        <div className="flex-1 flex flex-col items-center gap-1 mt-4">
          <RailNav icon={<MessageCircle size={20} />} label="聊天" active={(activeView === 'chat' || !activeView) && tab === 'chat'} onClick={() => setTab('chat')} />
          <RailNav icon={<Users size={20} />} label="通讯录" active={(activeView === 'chat' || !activeView) && tab === 'contacts'} onClick={() => setTab('contacts')} />
        </div>
        <div className="flex flex-col items-center gap-1 mb-1">
          <RailIcon title="搜索聊天记录" onClick={onOpenSearch}><Search size={18} /></RailIcon>
          <RailIcon title="我的收藏" onClick={onOpenFavorites}><Star size={18} /></RailIcon>
          <RailIcon title={theme === 'dark' ? '切换为浅色' : '切换为深色'} onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</RailIcon>
          <Tooltip content={notifState === 'granted' ? '桌面通知已开启' : notifState === 'denied' ? '通知被浏览器拦截，请在站点设置中允许' : notifState === 'unsupported' ? '当前环境不支持桌面通知' : '开启被 @ 时的桌面通知'}>
            <RailIcon title="桌面通知" onClick={onEnableNotifications} disabled={notifState === 'unsupported'}>
              {notifState === 'granted' ? <Bell size={18} /> : <BellOff size={18} />}
            </RailIcon>
          </Tooltip>
          <RailIcon title="设置" onClick={onOpenSettings}><Settings size={18} /></RailIcon>
        </div>
      </nav>

      {/* 中间列表区 280px */}
      <div
        className="flex flex-col w-[280px] h-full flex-shrink-0"
        style={{ borderRight: '1px solid var(--td-component-stroke)' }}
      >
        {/* 列表头：搜索 + 发起群聊 */}
        <div className="h-14 px-3 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--td-component-stroke)' }}>
          <div className="flex-1 min-w-0">
            <Input
              value={search}
              onChange={e => setSearch(e as string)}
              placeholder={tab === 'chat' ? '搜索聊天' : '搜索联系人'}
              prefixIcon={<Search size={14} />}
              clearable
            />
          </div>
          <Tooltip content="发起群聊">
            <button onClick={onCreateGroup} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
              <Plus />
            </button>
          </Tooltip>
          {totalUnread > 0 && (
            <Tooltip content="全部标记为已读">
              <button onClick={() => onMarkAllRead?.()} className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-secondary)' }}>
                <CheckCheck />
              </button>
            </Tooltip>
          )}
        </div>

        {/* 列表体 */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {tab === 'chat' && (
            filteredConvs.length === 0 ? (
              <div className="text-center text-sm mt-10" style={{ color: 'var(--td-text-color-placeholder)' }}>
                {q ? '没有匹配的会话' : '还没有会话，去通讯录找个朋友聊聊吧'}
              </div>
            ) : filteredConvs.map(conv => (
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
                    <span className="truncate text-sm font-medium flex items-center gap-1" style={{ color: 'var(--td-text-color-primary)' }}>
                      {conv.pinned && <Pin size={12} style={{ color: '#07c160', flexShrink: 0 }} />}
                      {conv.title}
                      {conv.muted && <BellOff size={12} style={{ color: 'var(--td-text-color-placeholder)', flexShrink: 0 }} />}
                    </span>
                    <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--td-text-color-placeholder)' }}>{fmtTime(conv.lastMessage?.createdAt)}</span>
                  </div>
                  <div className="truncate text-xs mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    {conv.lastMessage?.meta?.mentions?.includes(meId) && (
                      <span className="text-[11px] px-1 rounded mr-1" style={{ color: '#fff', backgroundColor: '#e34d59' }}>@我</span>
                    )}
                    {conv.lastMessage ? (conv.lastMessage.senderId === 'me' ? '我: ' : '') + conv.lastMessage.content : '暂无消息'}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {onTogglePin && (
                    <Tooltip content={conv.pinned ? '取消置顶' : '置顶会话'}>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => { e.stopPropagation(); onTogglePin(conv.id, !conv.pinned); }}
                        style={{ color: conv.pinned ? '#07c160' : 'var(--td-text-color-secondary)' }}
                      >
                        <Pin size={15} />
                      </button>
                    </Tooltip>
                  )}
                  {onToggleMute && (
                    <Tooltip content={conv.muted ? '允许通知' : '消息免打扰'}>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => { e.stopPropagation(); onToggleMute(conv.id, !conv.muted); }}
                        style={{ color: conv.muted ? '#e34d59' : 'var(--td-text-color-secondary)' }}
                      >
                        {conv.muted ? <BellOff size={15} /> : <Bell size={15} />}
                      </button>
                    </Tooltip>
                  )}
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
              </div>
            ))
          )}

          {tab === 'contacts' && (
            <>
              {agents.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>智能助手</div>
              )}
              {agents.map(c => (
                <div key={c.id} onClick={() => onOpenContactCard?.(c.id) ?? onSelectContact(c.id)} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]">
                  <Avatar text={c.avatarText} color={c.avatarColor} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{c.name}</div>
                    <div className="truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>AI 助手 · 可聊天 / 远程协助</div>
                  </div>
                  <Tooltip content="让助手操作你的电脑（远程协助）">
                    <button
                      className="flex-shrink-0 p-1.5 rounded-md transition-colors hover:bg-[var(--td-bg-color-component-hover)]"
                      onClick={e => { e.stopPropagation(); onOpenRemoteAssist?.(); }}
                      style={{ color: '#e34d59' }}
                    >
                      <Monitor size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content="编辑助手资料">
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={e => { e.stopPropagation(); setEditContact(c); }}
                      style={{ color: 'var(--td-text-color-secondary)' }}
                    >
                      <Pencil size={15} />
                    </button>
                  </Tooltip>
                </div>
              ))}
              {/* 星标朋友 */}
              {!q && starredContacts.length > 0 && (
                <>
                  <div className="px-3 pt-3 pb-1 text-xs flex items-center gap-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                    <Star size={12} fill="#faad14" color="#faad14" /> 星标朋友
                  </div>
                  {starredContacts.map(c => (
                    <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]" onClick={() => onOpenContactCard?.(c.id)}>
                      <Avatar text={c.avatarText} color={c.avatarColor} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{c.remark || c.name}</div>
                        {c.remark && <div className="truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{c.name}</div>}
                      </div>
                      {onToggleStar && (
                        <Tooltip content="取消星标">
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            onClick={e => { e.stopPropagation(); onToggleStar(c.id, false); }}
                            style={{ color: '#faad14' }}
                          >
                            <Star size={15} fill="#faad14" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  ))}
                </>
              )}
              <div className="flex items-center justify-between px-3 pt-3 pb-1">
                <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>联系人{q ? `（${filteredHumans.length}）` : ''}</span>
                <Tooltip content="添加联系人">
                  <button onClick={() => setAddDialog(true)} className="p-1 rounded-lg hover:bg-[var(--td-bg-color-component-hover)] flex-shrink-0" style={{ color: 'var(--td-text-color-secondary)' }}>
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
                <div key={c.id} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]" onClick={() => onOpenContactCard?.(c.id) ?? onSelectContact(c.id)}>
                  <Avatar text={c.avatarText} color={c.avatarColor} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{c.remark || c.name}</div>
                    {c.remark && <div className="truncate text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{c.name}</div>}
                  </div>
                  {onToggleStar && (
                    <Tooltip content={c.starred ? '取消星标' : '设为星标'}>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={e => { e.stopPropagation(); onToggleStar(c.id, !c.starred); }}
                        style={{ color: c.starred ? '#faad14' : 'var(--td-text-color-secondary)' }}
                      >
                        <Star size={15} fill={c.starred ? '#faad14' : 'none'} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip content="编辑联系人">
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={e => { e.stopPropagation(); setEditContact(c); }}
                      style={{ color: 'var(--td-text-color-secondary)' }}
                    >
                      <Pencil size={15} />
                    </button>
                  </Tooltip>
                  <Tooltip content="删除联系人">
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
