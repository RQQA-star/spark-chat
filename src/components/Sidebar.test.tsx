import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import type { Conversation, Contact } from '../types';

const contacts = [
  { id: 'me', name: '我', isAgent: false, status: 'online' },
  { id: 'u2', name: '对方', isAgent: false, status: 'online' },
] as unknown as Contact[];

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    type: 'direct',
    title: '对方',
    isRemoteAssist: false,
    remoteAssistActive: false,
    participantIds: ['me', 'u2'],
    messageCount: 1,
    lastMessage: { content: '你好', msgType: 'text', senderId: 'u2', createdAt: new Date().toISOString() },
    ...over,
  } as Conversation;
}

const baseProps = {
  contacts,
  currentConversationId: null as string | null,
  onSelectConversation: vi.fn(),
  onSelectContact: vi.fn(),
  onCreateGroup: vi.fn(),
  onDeleteConversation: vi.fn(),
  onAddContact: vi.fn(),
  onDeleteContact: vi.fn(),
  onEditContact: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenSearch: vi.fn(),
  theme: 'light',
  onToggleTheme: vi.fn(),
};

describe('Sidebar —— 草稿前缀', () => {
  it('有草稿时显示 [草稿] 前缀并覆盖最后消息预览', () => {
    render(<Sidebar {...baseProps} conversations={[conv()]} drafts={{ c1: '未发出的话' }} />);
    expect(screen.getByText('[草稿]')).toBeInTheDocument();
    expect(screen.getByText('未发出的话')).toBeInTheDocument();
    // 被草稿覆盖，原最后消息预览不应出现
    expect(screen.queryByText('你好')).toBeNull();
  });

  it('无草稿时显示最后消息预览（本人消息带「我: 」前缀）', () => {
    render(
      <Sidebar
        {...baseProps}
        conversations={[conv({ id: 'c2', lastMessage: { content: '我的消息', msgType: 'text', senderId: 'me', createdAt: new Date().toISOString() } })]}
        drafts={{ }}
      />,
    );
    expect(screen.queryByText('[草稿]')).toBeNull();
    expect(screen.getByText(/我的消息/)).toBeInTheDocument();
  });

  it('置顶会话排在列表最前', () => {
    render(
      <Sidebar
        {...baseProps}
        conversations={[
          conv({ id: 'a', title: '会话甲', pinned: false }),
          conv({ id: 'b', title: '会话乙', pinned: true }),
        ]}
      />,
    );
    const yi = screen.getByText('会话乙');
    const jia = screen.getByText('会话甲');
    // 会话乙（置顶）应出现在 会话甲 之前
    expect(yi.compareDocumentPosition(jia) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('免打扰会话不显示红色未读角标（仅普通会话显示）', () => {
    render(
      <Sidebar
        {...baseProps}
        conversations={[
          conv({ id: 'm', title: '免打扰会话', muted: true, unreadCount: 7 }),
          conv({ id: 'n', title: '普通会话', muted: false, unreadCount: 12 }),
        ]}
      />,
    );
    // 免打扰会话的未读数 7 不应以红色角标出现
    expect(screen.queryByText('7')).toBeNull();
    // 普通会话的未读数 12 仍显示
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
