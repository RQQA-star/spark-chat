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

  it('同天相邻消息间隔 <5 分钟仅首条显示时间戳', () => {
    const now = Date.now();
    const a = new Date(now - 60 * 1000).toISOString();   // 1 分钟前
    const b = new Date(now).toISOString();               // 现在
    renderMessages([msg({ id: 't1', createdAt: a }), msg({ id: 't2', createdAt: b })]);
    expect(screen.getAllByTestId('time-divider')).toHaveLength(1);
  });

  it('同天相邻消息间隔 >5 分钟显示两条时间戳', () => {
    const now = Date.now();
    const a = new Date(now - 10 * 60 * 1000).toISOString(); // 10 分钟前
    const b = new Date(now).toISOString();
    renderMessages([msg({ id: 't1', createdAt: a }), msg({ id: 't2', createdAt: b })]);
    expect(screen.getAllByTestId('time-divider')).toHaveLength(2);
  });

  it('同天时间戳显示具体时分（非「今天」）', () => {
    const fixed = new Date();
    fixed.setHours(14, 32, 0, 0);
    renderMessages([msg({ id: 't1', createdAt: fixed.toISOString() })]);
    const divider = screen.getAllByTestId('time-divider')[0];
    expect(divider).toHaveTextContent('14:32');
    expect(divider).not.toHaveTextContent('今天');
  });

  it('收到的语音消息未播放时显示未读红点', () => {
    renderMessages([msg({ id: 'v1', msgType: 'voice', senderId: 'other', audioPath: 'a.webm', duration: 3000 })], { playedVoice: new Set() });
    expect(screen.getByTestId('voice-unread')).toBeInTheDocument();
  });

  it('自己发送的语音消息不显示未读红点', () => {
    renderMessages([msg({ id: 'v2', msgType: 'voice', senderId: meId, audioPath: 'b.webm', duration: 3000 })], { playedVoice: new Set() });
    expect(screen.queryByTestId('voice-unread')).toBeNull();
  });

  it('已播放的语音消息不显示未读红点', () => {
    renderMessages([msg({ id: 'v3', msgType: 'voice', senderId: 'other', audioPath: 'c.webm', duration: 3000 })], { playedVoice: new Set(['v3']) });
    expect(screen.queryByTestId('voice-unread')).toBeNull();
  });

  it('气泡圆角统一为微信式（本人 8px 右下小尾 / 对方 8px 左下小尾）', () => {
    renderMessages([
      msg({ id: 'me1', senderId: meId, content: '我的消息' }),
      msg({ id: 'o1', senderId: 'other', content: '对方消息' }),
    ]);
    const meBubble = screen.getByText('我的消息').closest('div')!;
    const otherBubble = screen.getByText('对方消息').closest('div')!;
    expect(meBubble.style.borderRadius).toBe('8px 8px 2px 8px');
    expect(otherBubble.style.borderRadius).toBe('8px 8px 8px 2px');
  });

  it('媒体气泡（文件）同样采用微信式统一圆角', () => {
    renderMessages([msg({ id: 'f1', msgType: 'file', senderId: 'other', fileName: 'a.pdf', filePath: 'a.pdf', fileSize: 1024 })]);
    const fileLink = screen.getByText('a.pdf').closest('a')!;
    expect(fileLink.style.borderRadius).toBe('8px 8px 8px 2px');
  });

  it('引用块展示被引用者名称与预览，并采用微信式内嵌样式（6px 小圆角 + 2px 左 accent）', () => {
    renderMessages([msg({
      id: 'q1', senderId: meId, content: '回复内容',
      meta: { quote: { messageId: 'x', senderName: '对方', preview: '被引用的长文本预览' } },
    })]);
    const block = screen.getByTestId('quote-block');
    expect(block).toHaveTextContent('对方');
    expect(block).toHaveTextContent('被引用的长文本预览');
    expect(block.style.borderRadius).toBe('6px');
    expect(block.style.borderLeftWidth).toBe('2px');
  });

  it('消息行头像采用微信式圆形（rounded-full）', () => {
    renderMessages([msg({ id: 'a1', senderId: 'other', content: 'hi' })]);
    const avatar = screen.getByTestId('msg-avatar');
    expect(avatar.className).toContain('rounded-full');
    expect(avatar.className).not.toContain('rounded-lg');
  });
});
