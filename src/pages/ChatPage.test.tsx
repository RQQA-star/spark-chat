import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPage } from './ChatPage';
import type { Conversation, Contact, ConvMessage } from '../types';
import type { ChatPageProps } from './ChatPage';

const meId = 'me';

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'u2', name: '对方', isAgent: false, status: 'online',
    avatarText: '对', avatarColor: '#07c160',
    ...over,
  } as Contact;
}

function groupConv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'g1', type: 'group', title: '前端交流群',
    isRemoteAssist: false, remoteAssistActive: false,
    participantIds: ['me', 'u2', 'u3'],
    messageCount: 3,
    lastMessage: { content: 'hi', msgType: 'text', senderId: 'u2', createdAt: new Date().toISOString() },
    ...over,
  } as Conversation;
}

function directConv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'd1', type: 'direct', title: '对方',
    isRemoteAssist: false, remoteAssistActive: false,
    participantIds: ['me', 'u2'],
    messageCount: 1,
    lastMessage: { content: 'hi', msgType: 'text', senderId: 'u2', createdAt: new Date().toISOString() },
    ...over,
  } as Conversation;
}

function makeProps(over: Record<string, unknown> = {}): ChatPageProps {
  const fn = vi.fn();
  return {
    conversation: groupConv(),
    contacts: [contact({ id: 'me', name: '我' }), contact(), contact({ id: 'u3', name: '丙' })],
    meId,
    messages: [] as ConvMessage[],
    isAgentThinking: false,
    permissionRequest: null,
    isAgentConversation: false,
    agentName: '星火助手',
    onSendText: fn, onSendVoice: fn, onSendImage: fn, onSendFile: fn, onSendAgentAssist: fn, onStop: fn,
    onPermissionAllow: fn, onPermissionDeny: fn, onOpenRemoteAssist: fn, onOpenAgentConfig: fn, onBack: fn,
    onClearMessages: fn, onDeleteMessage: fn, onForward: fn, onRetry: fn, onEditMessage: fn, onRecallMessage: fn,
    onToggleReaction: fn, onDeleteMessages: fn, onBatchForward: fn, onPreviewImage: fn, onPreviewContact: fn,
    onFavorite: fn, onPat: fn, onReedit: fn, typingMembers: [] as string[], loadOlderMessages: fn,
    hasMoreMessages: false, isLoadingOlder: false, onManageGroup: fn, remoteAssistActive: false,
    onStartVideoCall: fn, focusMessageId: null, onClearFocusMessage: fn, draft: '', onDraftChange: fn,
    playedVoice: new Set<string>(), onVoicePlayed: fn,
    ...(over as Partial<ChatPageProps>),
  } as ChatPageProps;
}

describe('ChatPage —— 顶部会话标题栏微信式对齐', () => {
  it('群聊标题显示「群名 (人数)」', () => {
    render(<ChatPage {...makeProps({ conversation: groupConv() })} />);
    const title = screen.getByTestId('conv-title');
    expect(title).toHaveTextContent('前端交流群');
    expect(title).toHaveTextContent('(3)');
  });

  it('单聊标题显示对方备注名（无备注则回退名称）', () => {
    const props = makeProps({
      conversation: directConv(),
      contacts: [contact({ id: 'me', name: '我' }), contact({ id: 'u2', name: '对方', remark: '老王' })],
    });
    render(<ChatPage {...props} />);
    const title = screen.getByTestId('conv-title');
    expect(title).toHaveTextContent('老王');
    expect(title).not.toHaveTextContent('对方');
  });

  it('"…" 菜单默认收起，点击后展开次级操作', () => {
    const props = makeProps({ onClearMessages: vi.fn() });
    render(<ChatPage {...props} />);
    expect(screen.queryByTestId('menu-clear')).toBeNull();
    fireEvent.click(screen.getByTestId('header-more-btn'));
    expect(screen.getByTestId('menu-clear')).toBeInTheDocument();
    expect(screen.getByTestId('menu-remote')).toBeInTheDocument();
  });

  it('点击菜单项触发对应回调并自动收起菜单', () => {
    const onClearMessages = vi.fn();
    const props = makeProps({ onClearMessages });
    render(<ChatPage {...props} />);
    fireEvent.click(screen.getByTestId('header-more-btn'));
    fireEvent.click(screen.getByTestId('menu-clear'));
    expect(onClearMessages).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-clear')).toBeNull();
  });

  it('Agent 会话的 "…" 菜单含远程协助与助手设置，不含「发起远程协助」', () => {
    const props = makeProps({ isAgentConversation: true });
    render(
      <ChatPage
        {...props}
        conversation={directConv({ participantIds: ['me', 'agent1'] })}
        contacts={[contact({ id: 'me', name: '我' }), contact({ id: 'agent1', name: '星火', isAgent: true })]}
      />,
    );
    fireEvent.click(screen.getByTestId('header-more-btn'));
    expect(screen.getByTestId('menu-assist')).toBeInTheDocument();
    expect(screen.getByTestId('menu-cfg')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-remote')).toBeNull();
  });
});
