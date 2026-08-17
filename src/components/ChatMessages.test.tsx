import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatMessages } from './ChatMessages';
import type { ConvMessage, Contact } from '../types';

const meId = 'me';
const contacts = [
  { id: meId, name: '我', isAgent: false },
  { id: 'other', name: '对方', isAgent: false },
] as unknown as Contact[];

function msg(over: Partial<ConvMessage> = {}): ConvMessage {
  return {
    id: '1',
    conversationId: 'c1',
    senderId: 'other',
    msgType: 'text',
    content: '你好',
    createdAt: new Date().toISOString(),
    ...over,
  } as ConvMessage;
}

function renderMessages(messages: ConvMessage[], extra?: Partial<React.ComponentProps<typeof ChatMessages>>) {
  const messagesEndRef = { current: null } as React.RefObject<HTMLDivElement>;
  return render(
    <ChatMessages
      messages={messages}
      contacts={contacts}
      meId={meId}
      isGroup={false}
      messagesEndRef={messagesEndRef}
      {...extra}
    />,
  );
}

describe('ChatMessages —— 渲染与交互', () => {
  it('渲染普通文本消息内容', () => {
    renderMessages([msg({ content: '你好世界' })]);
    expect(screen.getByText('你好世界')).toBeInTheDocument();
  });

  it('群聊中显示发送者名称', () => {
    renderMessages([msg({ id: 'g1', senderId: 'other', content: '群消息' })], { isGroup: true });
    expect(screen.getByText('对方')).toBeInTheDocument();
    expect(screen.getByText('群消息')).toBeInTheDocument();
  });

  it('失败消息显示「发送失败」并提供可点击的重试按钮', () => {
    const onRetry = vi.fn();
    renderMessages([msg({ id: 'f1', senderId: meId, status: 'failed', content: 'x' })], { onRetry });
    expect(screen.getByText('发送失败')).toBeInTheDocument();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledWith('f1');
  });

  it('发送中消息显示「发送中…」且不提供重试', () => {
    renderMessages([msg({ id: 's1', senderId: meId, status: 'sending', content: 'y' })], { onRetry: vi.fn() });
    expect(screen.getByText('发送中…')).toBeInTheDocument();
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('已读消息显示双勾「已读」', () => {
    renderMessages([msg({ id: 'r1', senderId: meId, status: 'sent', content: 'z', readAt: new Date().toISOString() })]);
    expect(screen.getByLabelText('已读')).toBeInTheDocument();
    expect(screen.queryByLabelText('已送达')).toBeNull();
  });

  it('未读消息显示单勾「已送达」', () => {
    renderMessages([msg({ id: 'r1', senderId: meId, status: 'sent', content: 'z' })]);
    expect(screen.getByLabelText('已送达')).toBeInTheDocument();
    expect(screen.queryByLabelText('已读')).toBeNull();
  });

  it('拍一拍：对方拍我显示「对方 拍了拍 我」', () => {
    renderMessages([msg({ id: 'p1', msgType: 'pat', senderId: 'other', meta: { pattedId: 'me' } })]);
    expect(screen.getByText('对方 拍了拍 我')).toBeInTheDocument();
  });

  it('拍一拍：我拍对方显示「你 拍了拍 对方」', () => {
    renderMessages([msg({ id: 'p2', msgType: 'pat', senderId: meId, meta: { pattedId: 'other' } })]);
    expect(screen.getByText('你 拍了拍 对方')).toBeInTheDocument();
  });

  it('撤回 2 分钟内本人文本消息显示「重新编辑」按钮，点击回调原文', () => {
    const onReedit = vi.fn();
    renderMessages([msg({
      id: 're1', senderId: meId, msgType: 'text', content: '我要重新编辑', recalled: true, recalledAt: new Date().toISOString(),
    })], { onReedit });
    expect(screen.getByText('你 撤回了一条消息')).toBeInTheDocument();
    const btn = screen.getByText('重新编辑');
    fireEvent.click(btn);
    expect(onReedit).toHaveBeenCalledWith('我要重新编辑');
  });

  it('撤回超过 2 分钟不显示「重新编辑」按钮', () => {
    renderMessages([msg({
      id: 're2', senderId: meId, msgType: 'text', content: '过期', recalled: true,
      recalledAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    })], { onReedit: vi.fn() });
    expect(screen.getByText('你 撤回了一条消息')).toBeInTheDocument();
    expect(screen.queryByText('重新编辑')).toBeNull();
  });

  it('对方撤回的消息不显示「重新编辑」按钮', () => {
    renderMessages([msg({
      id: 're3', senderId: 'other', msgType: 'text', content: 'x', recalled: true, recalledAt: new Date().toISOString(),
    })], { onReedit: vi.fn() });
    expect(screen.getByText('对方 撤回了一条消息')).toBeInTheDocument();
    expect(screen.queryByText('重新编辑')).toBeNull();
  });

  it('撤回的非文本消息不显示「重新编辑」按钮', () => {
    renderMessages([msg({
      id: 're4', senderId: meId, msgType: 'image', content: '', recalled: true, recalledAt: new Date().toISOString(),
    })], { onReedit: vi.fn() });
    expect(screen.getByText('你 撤回了一条消息')).toBeInTheDocument();
    expect(screen.queryByText('重新编辑')).toBeNull();
  });
});
