// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as Ws from 'ws';

// 本机 @types/ws 对 WebSocket 客户端的类型解析不稳定，这里以 any 使用（与 ws-auth.test.ts 一致）。
const WebSocket: any = (Ws as any).WebSocket;

// 配置令牌，使本文件处于「已配置令牌」状态（与 auth 类测试隔离）。
process.env.SPARK_ACCESS_TOKEN = 'group-ws-secret';

vi.mock('@tencent-ai/agent-sdk', () => ({
  query: async function* () {},
  unstable_v2_createSession: async () => ({}),
  unstable_v2_authenticate: async () => ({}),
}));

import { startServer } from './index';

let server: ReturnType<typeof startServer>;
let port = 0;
const TOKEN = 'group-ws-secret';
const base = () => `http://127.0.0.1:${port}`;
const authH = { Authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  server = startServer(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });
  port = (server.address() as { port: number }).port;
});

afterAll(() => { server.close(); });

function openWs(conversationId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?conversationId=${conversationId}&token=${TOKEN}`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('群信息变更实时广播 conversation:update (#6 跨客户端同步)', () => {
  it('改名后订阅该会话的 WS 客户端收到 conversation:update（含新标题）', async () => {
    // 1. 创建一个群
    const create = await fetch(base() + '/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ type: 'group', participantIds: ['me', 'peer_a'], title: '原始群名' }),
    }).then(r => r.json() as any);
    expect(create.conversation).toBeTruthy();
    const convId = create.conversation.id;

    // 2. 打开该会话的 WS（模拟另一客户端）
    const ws = await openWs(convId);
    const received = new Promise<any>((resolve) => {
      ws.on('message', (data: any) => {
        try { resolve(JSON.parse(data.toString())); } catch { /* ignore */ }
      });
    });

    // 3. 经 API 改名
    const patch = await fetch(base() + `/api/conversations/${convId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ title: '改名后的群' }),
    });
    expect(patch.status).toBe(200);

    // 4. WS 应收到 conversation:update
    const msg: any = await Promise.race([
      received,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('超时未收到 conversation:update')), 4000)),
    ]);
    expect(msg.type).toBe('conversation:update');
    expect(msg.conversation.id).toBe(convId);
    expect(msg.conversation.title).toBe('改名后的群');

    try { ws.close(); } catch { /* ignore */ }
  });

  it('加成员后 WS 收到 conversation:update（participantIds 含新成员）', async () => {
    const create = await fetch(base() + '/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ type: 'group', participantIds: ['me', 'peer_a'], title: '群B' }),
    }).then(r => r.json() as any);
    const convId = create.conversation.id;

    const ws = await openWs(convId);
    const received = new Promise<any>((resolve) => {
      ws.on('message', (data: any) => {
        try { resolve(JSON.parse(data.toString())); } catch { /* ignore */ }
      });
    });

    const add = await fetch(base() + `/api/conversations/${convId}/participants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ contactId: 'peer_c' }),
    });
    expect(add.status).toBe(200);

    const msg: any = await Promise.race([
      received,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('超时未收到 conversation:update')), 4000)),
    ]);
    expect(msg.type).toBe('conversation:update');
    expect(msg.conversation.participantIds).toContain('peer_c');

    try { ws.close(); } catch { /* ignore */ }
  });
});
