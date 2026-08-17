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
