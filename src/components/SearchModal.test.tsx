import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchModal } from './SearchModal';

const SAMPLE = [
  {
    id: 'm-abc',
    conversationId: 'c-1',
    conversationTitle: 'Alice',
    conversationType: 'single',
    senderId: 'alice',
    senderName: 'Alice',
    msgType: 'text',
    content: '配置一下代理',
    createdAt: new Date().toISOString(),
  },
];

describe('SearchModal 搜索结果跳转', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ json: async () => ({ results: SAMPLE }) })) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('点击结果时把 conversationId 与 messageId 一并回传（定位跳转契约）', async () => {
    const onSelect = vi.fn();
    render(<SearchModal visible onClose={() => {}} onSelect={onSelect} />);
    const input = screen.getByPlaceholderText('输入关键词，搜索全部会话的消息');
    fireEvent.change(input, { target: { value: '代理' } });

    // 结果行：debounce 后出现；按内容含「配置一下」定位可点击行（「代理」被高亮 span 包裹）
    await waitFor(() => {
      const rows = document.querySelectorAll('div[class*="cursor-pointer"]');
      expect(rows.length).toBeGreaterThan(0);
    });
    const rows = Array.from(document.querySelectorAll('div[class*="cursor-pointer"]')) as HTMLElement[];
    const target = rows.find((r) => (r.textContent || '').includes('配置一下'));
    expect(target).toBeTruthy();
    fireEvent.click(target!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('c-1', 'm-abc');
  });
});

describe('SearchModal —— 加载中指示', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ json: async () => ({ results: [] }) })) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('输入关键词后加载中显示「搜索中…」', () => {
    vi.useFakeTimers();
    render(<SearchModal visible onClose={() => {}} onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('输入关键词，搜索全部会话的消息');
    fireEvent.change(input, { target: { value: '代理' } });
    expect(screen.getByTestId('search-loading')).toBeInTheDocument();
    expect(screen.getByText('搜索中…')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
