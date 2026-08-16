import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMessages } from './useMessages';
import type { Conversation, Contact, ConvMessage } from '../types';
import { MockWebSocket } from '../test/setup';

const meId = 'me';

const conversation = {
  id: 'c1',
  name: '测试会话',
  type: 'single',
  participantIds: [meId, 'other'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Conversation;

const contacts = [
  { id: meId, name: '我', isAgent: false },
  { id: 'other', name: '对方', isAgent: false },
] as unknown as Contact[];

function makeMsg(over: Partial<ConvMessage> = {}): ConvMessage {
  return {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'other',
    msgType: 'text',
    content: 'hello',
    createdAt: new Date().toISOString(),
    ...over,
  } as ConvMessage;
}

function emptyList() {
  return { ok: true, json: async () => ({ messages: [], oldest: null, hasMore: false }) };
}

describe('useMessages —— 消息加载与乐观发送', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    MockWebSocket.lastInstance = null;
  });

  it('loadMessages 拉取并填充消息', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/messages')) {
        return { ok: true, json: async () => ({ messages: [makeMsg()], oldest: null, hasMore: false }) };
      }
      return emptyList();
    });

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    expect(result.current.messages[0].content).toBe('hello');
  });

  it('sendText 乐观插入 sending，收到回包后标记为 sent', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string, opts?: { method?: string; body?: string }) => {
      if (url.includes('/messages') && opts?.method === 'POST') {
        const body = JSON.parse(opts.body || '{}');
        return {
          ok: true,
          json: async () => ({
            message: {
              id: body.clientId,
              conversationId: 'c1',
              senderId: meId,
              msgType: 'text',
              content: body.content,
              createdAt: new Date().toISOString(),
              status: 'sent',
            },
          }),
        };
      }
      return emptyList();
    });

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(0));

    await act(async () => {
      await result.current.sendText('你好');
    });

    await waitFor(() =>
      expect(result.current.messages.some((m) => m.status === 'sent' && m.content === '你好')).toBe(true),
    );
  });

  it('sendText 网络失败时标记 failed（保留内容可重试）', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (url.includes('/messages') && opts?.method === 'POST') {
        throw new Error('network error');
      }
      return emptyList();
    });

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(0));

    await act(async () => {
      await result.current.sendText('失败消息');
    });

    await waitFor(() => expect(result.current.messages.some((m) => m.status === 'failed')).toBe(true));
  });

  it('retryMessage 复用失败消息的 id 重新发送并标记为 sent', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    let attempt = 0;
    fetchMock.mockImplementation(async (url: string, opts?: { method?: string; body?: string }) => {
      if (url.includes('/messages') && opts?.method === 'POST') {
        attempt += 1;
        if (attempt === 1) throw new Error('network error');
        const body = JSON.parse(opts?.body || '{}');
        return {
          ok: true,
          json: async () => ({
            message: {
              id: body.clientId,
              conversationId: 'c1',
              senderId: meId,
              msgType: 'text',
              content: body.content,
              createdAt: new Date().toISOString(),
              status: 'sent',
            },
          }),
        };
      }
      return emptyList();
    });

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(0));

    await act(async () => {
      await result.current.sendText('重发');
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.status === 'failed')).toBe(true));

    const failedId = result.current.messages.find((m) => m.status === 'failed')!.id;
    await act(async () => {
      await result.current.retryMessage(failedId);
    });

    await waitFor(() => expect(result.current.messages.some((m) => m.status === 'sent')).toBe(true));
  });

  it('loadOlderMessages 把更早消息 prepend 到列表头部', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/messages') && url.includes('beforeCreatedAt')) {
        return { ok: true, json: async () => ({ messages: [makeMsg({ id: 'old', content: '更早' })], oldest: null, hasMore: false }) };
      }
      if (url.includes('/messages')) {
        return {
          ok: true,
          json: async () => ({ messages: [makeMsg({ id: 'new', content: '较新' })], oldest: { createdAt: '2020', id: 'new' }, hasMore: true }),
        };
      }
      return emptyList();
    });

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(1));
    expect(result.current.messages[0].content).toBe('较新');

    await act(async () => {
      await result.current.loadOlderMessages();
    });

    await waitFor(() => expect(result.current.messages.length).toBe(2));
    expect(result.current.messages[0].content).toBe('更早');
    expect(result.current.messages[1].content).toBe('较新');
  });

  it('WebSocket 收到 message:new 时追加，重复收到同一条则幂等（仅一条）', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () => emptyList());

    const { result } = renderHook(() => useMessages(conversation, contacts, meId));
    await waitFor(() => expect(result.current.messages.length).toBe(0));

    const ws = MockWebSocket.lastInstance as unknown as {
      onopen?: () => void;
      onmessage?: (ev: { data: string }) => void;
    };
    expect(ws).toBeTruthy();
    ws.onopen?.();

    const incoming = makeMsg({ id: 'ws1', senderId: 'other', content: '实时' });
    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'message:new', message: incoming }) });
    });
    await waitFor(() => expect(result.current.messages.some((m) => m.id === 'ws1' && m.content === '实时')).toBe(true));

    await act(async () => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'message:new', message: incoming }) });
    });
    await waitFor(() => expect(result.current.messages.filter((m) => m.id === 'ws1').length).toBe(1));
  });
});
