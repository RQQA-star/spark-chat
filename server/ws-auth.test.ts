// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as Ws from 'ws';

// 本机 @types/ws 对 WebSocket 客户端的类型解析不稳定（构造函数/terminate 缺失），这里以 any 使用。
const WebSocket: any = (Ws as any).WebSocket;

// 在导入前配置令牌，使本文件的模块实例处于「已配置令牌」状态（与 auth.test.ts 隔离，各 worker 独立）。
process.env.SPARK_ACCESS_TOKEN = 'ws-secret-token';

vi.mock('@tencent-ai/agent-sdk', () => ({
  query: async function* () {},
  unstable_v2_createSession: async () => ({}),
  unstable_v2_authenticate: async () => ({}),
}));

import { startServer } from './index';

let server: ReturnType<typeof startServer>;
let port = 0;

beforeAll(async () => {
  server = startServer(0, '127.0.0.1');
  // server.listen 是异步的，需等待 listening 事件后 address() 才有值
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

// 尝试升级 /ws，返回是否成功升级（ok）以及被拒时的 HTTP 状态码（code）。
function connectWs(opts: { origin?: string; token?: string }): Promise<{ ok: boolean; code?: number }> {
  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}/ws?conversationId=ws-test${opts.token ? `&token=${opts.token}` : ''}`;
    const ws = new WebSocket(url, opts.origin ? { headers: { Origin: opts.origin } } : {});
    const timer = setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } resolve({ ok: false }); }, 5000);
    ws.on('open', () => { clearTimeout(timer); try { ws.close(); } catch { /* ignore */ } resolve({ ok: true }); });
    ws.on('error', (err: any) => {
      clearTimeout(timer);
      const m = String(err?.message || '');
      const code = /response: (\d+)/.exec(m);
      resolve({ ok: false, code: code ? Number(code[1]) : undefined });
    });
    ws.on('unexpected-response', (_req: unknown, res: { statusCode?: number }) => {
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* ignore */ }
      resolve({ ok: false, code: res?.statusCode });
    });
  });
}

describe('WebSocket /ws 升级鉴权与 Origin 校验 (S3 + G3)', () => {
  it('本机 Origin + 正确令牌 → 升级成功', async () => {
    const r = await connectWs({ origin: 'http://localhost:5173', token: 'ws-secret-token' });
    expect(r.ok).toBe(true);
  });

  it('无 Origin（非浏览器客户端）+ 正确令牌 → 升级成功', async () => {
    const r = await connectWs({ token: 'ws-secret-token' });
    expect(r.ok).toBe(true);
  });

  it('缺少令牌 → 401 拒绝', async () => {
    const r = await connectWs({ origin: 'http://localhost:5173' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(401);
  });

  it('错误令牌 → 401 拒绝', async () => {
    const r = await connectWs({ origin: 'http://localhost:5173', token: 'wrong' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(401);
  });

  it('恶意跨站 Origin（https://evil.com）+ 正确令牌 → 403 拒绝', async () => {
    const r = await connectWs({ origin: 'https://evil.com', token: 'ws-secret-token' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(403);
  });
});
