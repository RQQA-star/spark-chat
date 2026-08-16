// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

vi.mock('@tencent-ai/agent-sdk', () => ({
  query: async function* () {},
  unstable_v2_createSession: async () => ({}),
  unstable_v2_authenticate: async () => ({}),
  createSdkMcpServer: (opts: any) => ({ type: 'sdk', name: opts?.name, instance: {} }),
  tool: (name: string, description: string, inputSchema: any, handler: any) => ({ name, description, inputSchema, handler }),
}));

import { app } from './index';

async function createDirectWith(contactId: string) {
  const res = await request(app)
    .post('/api/conversations')
    .send({ type: 'direct', participantIds: [contactId] });
  expect(res.status, `create conversation failed: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.conversation as { id: string };
}

function postMessage(convId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/conversations/${convId}/messages`).send(body);
}

describe('P1 · 联系人备注 / 星标朋友', () => {
  it('PATCH 联系人可设置备注与星标，并在列表返回', async () => {
    const patch = await request(app)
      .patch('/api/contacts/u_alice')
      .send({ remark: '测试备注', starred: true });
    expect(patch.status).toBe(200);
    expect(patch.body.contact.remark).toBe('测试备注');
    expect(patch.body.contact.starred).toBe(true);

    const list = await request(app).get('/api/contacts');
    const alice = list.body.contacts.find((c: any) => c.id === 'u_alice');
    expect(alice.remark).toBe('测试备注');
    expect(alice.starred).toBe(true);

    // 恢复，避免影响其它用例
    await request(app).patch('/api/contacts/u_alice').send({ remark: '', starred: false });
  });

  it('备注过长 → 400', async () => {
    const res = await request(app)
      .patch('/api/contacts/u_alice')
      .send({ remark: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });
});

describe('P1 · 群公告', () => {
  it('PATCH 会话可设置群公告', async () => {
    const conv = await createDirectWith('u_bob');
    const res = await request(app)
      .patch(`/api/conversations/${conv.id}`)
      .send({ announcement: '欢迎加入本群' });
    expect(res.status).toBe(200);
    expect(res.body.conversation.announcement).toBe('欢迎加入本群');
  });

  it('群公告过长 → 400', async () => {
    const conv = await createDirectWith('u_carol');
    const res = await request(app)
      .patch(`/api/conversations/${conv.id}`)
      .send({ announcement: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });
});

describe('P1 · 消息收藏', () => {
  it('收藏 / 列表 / 取消收藏', async () => {
    const conv = await createDirectWith('u_alice');
    const msg = await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '要收藏的内容' });
    expect(msg.status).toBe(200);
    const messageId = msg.body.message.id;

    const add = await request(app)
      .post('/api/favorites')
      .send({ messageId, conversationId: conv.id });
    expect(add.status).toBe(200);
    expect(add.body.favorite.content).toBe('要收藏的内容');
    const favId = add.body.favorite.id;

    // 重复收藏幂等（返回已存在记录，不报错）
    const dup = await request(app)
      .post('/api/favorites')
      .send({ messageId, conversationId: conv.id });
    expect(dup.status).toBe(200);
    expect(dup.body.already).toBe(true);

    const list = await request(app).get('/api/favorites');
    expect(list.body.favorites.some((f: any) => f.id === favId)).toBe(true);

    const del = await request(app).delete(`/api/favorites/${favId}`);
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const list2 = await request(app).get('/api/favorites');
    expect(list2.body.favorites.some((f: any) => f.id === favId)).toBe(false);
  });

  it('收藏不存在的消息 → 404', async () => {
    const conv = await createDirectWith('u_bob');
    const res = await request(app)
      .post('/api/favorites')
      .send({ messageId: 'nonexistent-' + uuidv4(), conversationId: conv.id });
    expect(res.status).toBe(404);
  });
});

describe('P1 · 一键全部已读', () => {
  it('POST /api/conversations/read-all 将各会话未读清零', async () => {
    const conv = await createDirectWith('u_carol');
    // 对方发来一条消息（未读）
    await postMessage(conv.id, { senderId: 'u_carol', msgType: 'text', content: 'hi' });
    const before = await request(app).get('/api/conversations');
    const c = before.body.conversations.find((x: any) => x.id === conv.id);
    expect(c.unreadCount).toBeGreaterThanOrEqual(1);

    const res = await request(app).post('/api/conversations/read-all');
    expect(res.status).toBe(200);

    const after = await request(app).get('/api/conversations');
    const c2 = after.body.conversations.find((x: any) => x.id === conv.id);
    expect(c2.unreadCount).toBe(0);
  });
});
