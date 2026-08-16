// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// 在导入 app 之前设置访问令牌，使本文件的模块实例处于「已配置令牌」状态。
// 由于鉴权读取发生在请求时（server/security.ts 的 getAccessToken），此赋值会在所有测试用例执行前生效。
// 每个测试文件由独立的 worker 运行，不会污染 index.test.ts 等未配置令牌的文件。
process.env.SPARK_ACCESS_TOKEN = 'test-secret-token';

// 替掉重型 agent-sdk，避免测试加载原生/网络模块
vi.mock('@tencent-ai/agent-sdk', () => ({
  query: async function* () {},
  unstable_v2_createSession: async () => ({}),
  unstable_v2_authenticate: async () => ({}),
}));

import { app } from './index';

describe('本地鉴权 G3 · 已配置 SPARK_ACCESS_TOKEN', () => {
  it('无 Authorization 头 → 401', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  it('错误令牌 → 401', async () => {
    const res = await request(app).get('/api/conversations').set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('正确 Bearer 令牌 → 200', async () => {
    const res = await request(app).get('/api/conversations').set('Authorization', 'Bearer test-secret-token');
    expect(res.status).toBe(200);
  });

  it('POST 接口也强制鉴权 → 无令牌 401', async () => {
    const res = await request(app)
      .post('/api/conversations')
      .set('Authorization', 'Bearer wrong')
      .send({ type: 'group', participantIds: ['me', 'peer_x'], title: 't' });
    expect(res.status).toBe(401);
  });

  it('/api/health 始终免鉴权 → 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Origin 校验 S3 · 已配置令牌', () => {
  const auth = { Authorization: 'Bearer test-secret-token' };

  it('恶意跨站 Origin（https://evil.com）→ 403', async () => {
    const res = await request(app).get('/api/conversations').set('Origin', 'https://evil.com').set(auth);
    expect(res.status).toBe(403);
  });

  it('内网来源（http://192.168.1.10）→ 403', async () => {
    const res = await request(app).get('/api/conversations').set('Origin', 'http://192.168.1.10:3000').set(auth);
    expect(res.status).toBe(403);
  });

  it('本机 Origin（http://localhost:5173，Vite 开发服务器）→ 200', async () => {
    const res = await request(app).get('/api/conversations').set('Origin', 'http://localhost:5173').set(auth);
    expect(res.status).toBe(200);
  });

  it('本机 Origin（http://127.0.0.1:3000，同端口）→ 200', async () => {
    const res = await request(app).get('/api/conversations').set('Origin', 'http://127.0.0.1:3000').set(auth);
    expect(res.status).toBe(200);
  });

  it('无 Origin（curl / supertest 等非浏览器客户端）→ 200', async () => {
    const res = await request(app).get('/api/conversations').set(auth);
    expect(res.status).toBe(200);
  });
});
