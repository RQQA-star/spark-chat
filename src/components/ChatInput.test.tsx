import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import type { Contact } from '../types';

const baseProps = {
  onSendText: vi.fn(),
  onSendVoice: vi.fn(),
  onSendImage: vi.fn(),
  isAgentThinking: false,
  onStop: vi.fn(),
  placeholder: '输入消息…',
  isGroup: false,
  members: [] as Contact[],
  meId: 'me',
  onCancelReply: vi.fn(),
  onSendFile: vi.fn(),
  onSendSticker: vi.fn(),
  onSendLink: vi.fn(),
  onSendVideo: vi.fn(),
  onSendLocation: vi.fn(),
  onSendCard: vi.fn(),
  contacts: [] as Contact[],
};

const ta = () => screen.getByPlaceholderText('输入消息…') as HTMLTextAreaElement;

describe('ChatInput —— 草稿', () => {
  it('输入文本时回传 onDraftChange', () => {
    const onDraftChange = vi.fn();
    render(<ChatInput {...baseProps} onDraftChange={onDraftChange} />);
    fireEvent.change(ta(), { target: { value: '草稿内容' } });
    expect(onDraftChange).toHaveBeenCalledWith('草稿内容');
  });

  it('draft prop 变化时回填输入框', () => {
    const { rerender } = render(<ChatInput {...baseProps} draft="" />);
    expect(ta().value).toBe('');
    rerender(<ChatInput {...baseProps} draft="已存的草稿" />);
    expect(ta().value).toBe('已存的草稿');
  });

  it('发送后清空输入框并回传 onDraftChange("")', () => {
    const onDraftChange = vi.fn();
    const onSendText = vi.fn();
    render(<ChatInput {...baseProps} onDraftChange={onDraftChange} onSendText={onSendText} />);
    fireEvent.change(ta(), { target: { value: '要发送' } });
    fireEvent.keyDown(ta(), { key: 'Enter', shiftKey: false });
    expect(onSendText).toHaveBeenCalledWith('要发送', [], undefined);
    expect(onDraftChange).toHaveBeenLastCalledWith('');
    expect(ta().value).toBe('');
  });
});

const groupProps = {
  ...baseProps,
  isGroup: true,
  meId: 'me',
  members: [
    { id: 'u1', name: '张三', avatarText: '张', avatarColor: '#07c160', isAgent: false, status: 'online' },
    { id: 'u2', name: '李四', avatarText: '李', avatarColor: '#0052d9', isAgent: false, status: 'online' },
    { id: 'u3', name: '王五', avatarText: '王', avatarColor: '#e34d59', isAgent: false, status: 'online' },
  ] as Contact[],
};

describe('ChatInput —— @ 提及下拉（微信式）', () => {
  it('群聊输入 @ 弹出成员下拉，首位为「所有人」', () => {
    render(<ChatInput {...groupProps} />);
    fireEvent.change(ta(), { target: { value: '@' } });
    expect(screen.getByTestId('mention-popover')).toBeInTheDocument();
    expect(screen.getByTestId('mention-item-all')).toBeInTheDocument();
    expect(screen.getByTestId('mention-item-u1')).toBeInTheDocument();
    expect(screen.getByTestId('mention-item-u3')).toBeInTheDocument();
  });

  it('单聊（非群）输入 @ 不弹成员下拉', () => {
    render(<ChatInput {...baseProps} />);
    fireEvent.change(ta(), { target: { value: '@' } });
    expect(screen.queryByTestId('mention-popover')).toBeNull();
  });

  it('下拉按输入内容过滤成员', () => {
    render(<ChatInput {...groupProps} />);
    fireEvent.change(ta(), { target: { value: '@张' } });
    expect(screen.queryByTestId('mention-item-u1')).toBeInTheDocument(); // 张三
    expect(screen.queryByTestId('mention-item-u2')).toBeNull(); // 李四被过滤
  });

  it('点击下拉项把「@姓名 」插入输入框', () => {
    render(<ChatInput {...groupProps} />);
    fireEvent.change(ta(), { target: { value: '@' } });
    fireEvent.click(screen.getByTestId('mention-item-u2')); // 李四
    expect(ta().value).toBe('@李四 ');
  });

  it('键盘 ↑/↓ 选择 + 回车插入对应成员', () => {
    render(<ChatInput {...groupProps} />);
    fireEvent.change(ta(), { target: { value: '@' } });
    fireEvent.keyDown(ta(), { key: 'ArrowDown' }); // active 0→1（张三）
    fireEvent.keyDown(ta(), { key: 'Enter' });
    expect(ta().value).toBe('@张三 ');
  });

  it('打开下拉后按 Esc 关闭', () => {
    render(<ChatInput {...groupProps} />);
    fireEvent.change(ta(), { target: { value: '@' } });
    expect(screen.getByTestId('mention-popover')).toBeInTheDocument();
    fireEvent.keyDown(ta(), { key: 'Escape' });
    expect(screen.queryByTestId('mention-popover')).toBeNull();
  });
});

describe('ChatInput —— 表情面板（定位/层级）', () => {
  it('点击表情按钮弹出表情面板，点选 emoji 插入输入框', () => {
    render(<ChatInput {...baseProps} />);
    fireEvent.click(screen.getByTitle('表情'));
    expect(screen.getByTestId('emoji-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('emoji-item-0')); // EMOJIS[0] = 😀
    expect(ta().value).toContain('😀');
  });

  it('表情面板浮层带高层级（z-30）不被输入框裁剪', () => {
    render(<ChatInput {...baseProps} />);
    fireEvent.click(screen.getByTitle('表情'));
    const pop = screen.getByTestId('emoji-popover');
    expect(pop.className).toContain('z-30');
    expect(pop.className).toContain('bottom-full'); // 定位于输入框上方
  });
});
