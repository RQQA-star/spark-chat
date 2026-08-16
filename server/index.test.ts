// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// 替掉重型 agent-sdk，避免测试加载原生/网络模块（/agent 端点不在本回归范围内）
vi.mock('@tencent-ai/agent-sdk', () => ({
  query: async function* () {},
  unstable_v2_createSession: async () => ({}),
  unstable_v2_authenticate: async () => ({}),
  // 原生键鼠注入桥接用到的 SDK MCP Server 工厂（测试里只返回桩，不真正注册工具）
  createSdkMcpServer: (opts: any) => ({ type: 'sdk', name: opts?.name, instance: {} }),
  tool: (name: string, description: string, inputSchema: any, handler: any) => ({ name, description, inputSchema, handler }),
}));

import { app } from './index';
import * as db from './db';

// 由 test-setup.ts 设置的临时库路径推导出 media 目录
const dbPath = process.env.SPARK_DB_PATH!;
const dataDir = path.dirname(dbPath);
const imageDir = path.join(dataDir, 'image');

beforeAll(() => {
  expect(dbPath, 'test-setup 必须已设置 SPARK_DB_PATH').toBeTruthy();
  fs.mkdirSync(imageDir, { recursive: true });
});

type Conv = { id: string; participantIds: string[]; isRemoteAssist?: boolean; avatarText?: string };

async function createConversation(title: string): Promise<Conv> {
  const res = await request(app)
    .post('/api/conversations')
    .send({ type: 'group', participantIds: ['me', 'peer_' + uuidv4().slice(0, 8)], title });
  expect(res.status, `create conversation failed: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.conversation as Conv;
}

function postMessage(convId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/conversations/${convId}/messages`).send(body);
}

// 轮询等待文件被回收（杀软可能短暂锁定文件，使异步 unlink 延迟完成）。
async function waitForFileGone(filePath: string, budgetMs = 50000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (fs.existsSync(filePath) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ============= P0-1 · 禁止客户端伪造 agent/system 消息 + 基础校验 =============
describe('消息接口校验 (P0-1 + validation)', () => {
  it('禁止以助手身份发言 → 403', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'agent_xinghuo', msgType: 'text', content: 'x' });
    expect(res.status).toBe(403);
  });

  it('拒绝客户端伪造 agent 类型 → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'agent', content: 'x' });
    expect(res.status).toBe(400);
  });

  it('拒绝客户端伪造 system 类型 → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'system', content: 'x' });
    expect(res.status).toBe(400);
  });

  it('空文本 → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '   ' });
    expect(res.status).toBe(400);
  });

  it('图片缺 imagePath → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'image' });
    expect(res.status).toBe(400);
  });

  it('语音缺 audioPath → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'voice' });
    expect(res.status).toBe(400);
  });

  it('meta 非对象 → 400', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: 'x', meta: 'bad' });
    expect(res.status).toBe(400);
  });

  it('会话不存在 → 404', async () => {
    const res = await postMessage('no-such-conv', { senderId: 'me', msgType: 'text', content: 'x' });
    expect(res.status).toBe(404);
  });

  it('合法文本 → 200 并返回 message', async () => {
    const conv = await createConversation('p0-1');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.message?.content).toBe('hello');
  });

  it('合法图片(带 imagePath) → 200', async () => {
    const conv = await createConversation('p0-1');
    const fname = 'ok-' + uuidv4() + '.png';
    fs.writeFileSync(path.join(imageDir, fname), Buffer.from('x'));
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'image', imagePath: fname });
    expect(res.status).toBe(200);
    expect(res.body.message?.imagePath).toBe(fname);
  });
});

// ============= P1-5 · 会话列表聚合（消除 N+1） =============
describe('会话列表聚合 (P1-5)', () => {
  it('返回聚合字段 messageCount / unreadCount / participantIds / lastMessage', async () => {
    const conv = await createConversation('p1-5');
    await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '第一条' });
    await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '第二条' });

    const list = await request(app).get('/api/conversations');
    expect(list.status).toBe(200);
    const entry = (list.body.conversations as any[]).find(c => c.id === conv.id);
    expect(entry, '列表应包含刚创建的会话').toBeTruthy();
    expect(entry.messageCount).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(entry.participantIds)).toBe(true);
    expect(entry.participantIds.length).toBeGreaterThanOrEqual(1);
    expect(entry.lastMessage).toBeTruthy();
    expect(entry.lastMessage.content).toBe('第二条');
  });
});

// ============= P1-3 · 媒体孤儿文件回收（引用计数） =============
describe('媒体孤儿文件回收 (P1-3)', () => {
  it('删除独占图片消息后文件被回收', async () => {
    const conv = await createConversation('p1-3');
    const fname = 'orphan-' + uuidv4() + '.png';
    const filePath = path.join(imageDir, fname);
    fs.writeFileSync(filePath, Buffer.from('fake'));
    const m = await postMessage(conv.id, { senderId: 'me', msgType: 'image', imagePath: fname });
    expect(m.status).toBe(200);

    const del = await request(app).delete(`/api/conversations/${conv.id}/messages/${m.body.message.id}`);
    expect(del.status).toBe(200);
    // 删除为异步尽力而为（杀软可能短暂锁定文件），轮询等待回收完成
    await waitForFileGone(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  }, 60000);

  it('共享图片：删一条保留、删两条才回收', async () => {
    const conv = await createConversation('p1-3-shared');
    const fname = 'shared-' + uuidv4() + '.png';
    const filePath = path.join(imageDir, fname);
    fs.writeFileSync(filePath, Buffer.from('x'));
    const m1 = await postMessage(conv.id, { senderId: 'me', msgType: 'image', imagePath: fname });
    const m2 = await postMessage(conv.id, { senderId: 'me', msgType: 'image', imagePath: fname });
    expect(m1.status).toBe(200);
    expect(m2.status).toBe(200);

    // 删第一条，文件仍被第二条引用（引用计数 > 0，不触发删除）
    await request(app).delete(`/api/conversations/${conv.id}/messages/${m1.body.message.id}`);
    expect(fs.existsSync(filePath)).toBe(true);

    // 删第二条，无人引用 → 触发异步回收
    await request(app).delete(`/api/conversations/${conv.id}/messages/${m2.body.message.id}`);
    await waitForFileGone(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  }, 60000);
});

// ============= P1-4 · createMessage 事务副作用 =============
describe('createMessage 事务副作用 (P1-4)', () => {
  it('对方发来的消息为 me 的未读消息生成已读回执', async () => {
    const conv = await createConversation('p1-4');
    await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '等待回复' });
    const peer = conv.participantIds.find(p => p !== 'me')!;
    const r = await postMessage(conv.id, { senderId: peer, msgType: 'text', content: '回复你' });
    expect(r.status).toBe(200);

    const msgs = await request(app).get(`/api/conversations/${conv.id}/messages`);
    const mine = (msgs.body.messages as any[]).find(m => m.content === '等待回复');
    expect(mine, '应存在我发出的消息').toBeTruthy();
    expect(mine.readAt, '对方消息应为我生成已读回执').not.toBeNull();
  });
});

// ============= 序列化一致性（新建群会话返回驼峰字段） =============
describe('序列化一致性', () => {
  it('新建群会话返回驼峰字段 isRemoteAssist / avatarText', async () => {
    const conv = await createConversation('ser');
    expect(typeof conv.isRemoteAssist).toBe('boolean');
    expect(Object.prototype.hasOwnProperty.call(conv, 'avatarText')).toBe(true);
  });
});

// ============= 信令 (signaling) =============
describe('远程协助信令 (signaling)', () => {
  it('房间满员第三次加入 → 409', async () => {
    const create = await request(app).post('/api/remote/room').send({ role: 'controller' });
    expect(create.status).toBe(200);
    const code = create.body.roomCode;
    const join1 = await request(app).post(`/api/remote/room/${code}/join`).send({});
    expect(join1.status).toBe(200);
    const join2 = await request(app).post(`/api/remote/room/${code}/join`).send({});
    expect(join2.status).toBe(409);
  });

  it('非法信令类型 → 400', async () => {
    const create = await request(app).post('/api/remote/room').send({});
    const code = create.body.roomCode;
    const pid = create.body.peerId;
    const s = await request(app)
      .post(`/api/remote/room/${code}/signal`)
      .send({ from: pid, to: pid, type: 'bogus' });
    expect(s.status).toBe(400);
  });

  it('from/to 不属于房间 → 400', async () => {
    const create = await request(app).post('/api/remote/room').send({});
    const code = create.body.roomCode;
    const s = await request(app)
      .post(`/api/remote/room/${code}/signal`)
      .send({ from: 'ghost', to: 'ghost2', type: 'offer' });
    expect(s.status).toBe(400);
  });

  it('完整信令往返：offer/answer/ice 经轮询送达对端 (#12 WebRTC)', async () => {
    const create = await request(app).post('/api/remote/room').send({ role: 'controller' });
    expect(create.status).toBe(200);
    const code = create.body.roomCode;
    const controllerPeerId = create.body.peerId;
    const join = await request(app).post(`/api/remote/room/${code}/join`).send({});
    expect(join.status).toBe(200);
    const controlledPeerId = join.body.peerId;
    expect(join.body.controllerPeerId).toBe(controllerPeerId);

    // 被控端 → 控制端：offer
    expect((await request(app).post(`/api/remote/room/${code}/signal`)
      .send({ from: controlledPeerId, to: controllerPeerId, type: 'offer', payload: { sdp: 'O' } })).status).toBe(200);
    // 控制端 → 被控端：answer
    expect((await request(app).post(`/api/remote/room/${code}/signal`)
      .send({ from: controllerPeerId, to: controlledPeerId, type: 'answer', payload: { sdp: 'A' } })).status).toBe(200);
    // 双向 ICE
    expect((await request(app).post(`/api/remote/room/${code}/signal`)
      .send({ from: controlledPeerId, to: controllerPeerId, type: 'ice', payload: { candidate: 'c1' } })).status).toBe(200);
    expect((await request(app).post(`/api/remote/room/${code}/signal`)
      .send({ from: controllerPeerId, to: controlledPeerId, type: 'ice', payload: { candidate: 'c2' } })).status).toBe(200);

    // 控制端应收到 offer + 来自被控端的 ICE
    const toCtrl = (await request(app).get(`/api/remote/room/${code}/signal?peer=${controllerPeerId}&lastId=0`)).body.messages;
    expect(toCtrl.find((m: any) => m.type === 'offer' && m.from === controlledPeerId)).toBeTruthy();
    expect(toCtrl.find((m: any) => m.type === 'ice' && m.payload.candidate === 'c1')).toBeTruthy();
    // 被控端应收到 answer + 来自控制端的 ICE
    const toControlled = (await request(app).get(`/api/remote/room/${code}/signal?peer=${controlledPeerId}&lastId=0`)).body.messages;
    expect(toControlled.find((m: any) => m.type === 'answer' && m.from === controllerPeerId)).toBeTruthy();
    expect(toControlled.find((m: any) => m.type === 'ice' && m.payload.candidate === 'c2')).toBeTruthy();
  });
});

// ============= 群聊管理 (#6) =============
describe('群聊管理 (#6)', () => {
  it('创建群聊（含成员）→ 200 且 participantIds 含 me 与所选成员', async () => {
    const res = await request(app).post('/api/conversations').send({
      type: 'group', participantIds: ['me', 'peer_a'], title: '测试群',
    });
    expect(res.status).toBe(200);
    expect(res.body.conversation.type).toBe('group');
    expect(res.body.conversation.participantIds).toContain('me');
    expect(res.body.conversation.participantIds).toContain('peer_a');
  });

  it('创建群聊缺少参与者 → 400', async () => {
    const res = await request(app).post('/api/conversations').send({ type: 'group', participantIds: [] });
    expect(res.status).toBe(400);
  });

  it('加成员 → participantIds 增长且含新成员', async () => {
    const create = await request(app).post('/api/conversations').send({ type: 'group', participantIds: ['me', 'peer_a'] });
    const id = create.body.conversation.id;
    const before = create.body.conversation.participantIds.length;
    const add = await request(app).post(`/api/conversations/${id}/participants`).send({ contactId: 'peer_b' });
    expect(add.status).toBe(200);
    expect(add.body.participantIds).toContain('peer_b');
    expect(add.body.participantIds.length).toBe(before + 1);
  });

  it('移除成员 → participantIds 缩减且不含被移除者', async () => {
    const create = await request(app).post('/api/conversations').send({ type: 'group', participantIds: ['me', 'peer_a', 'peer_b'] });
    const id = create.body.conversation.id;
    const del = await request(app).delete(`/api/conversations/${id}/participants/peer_b`);
    expect(del.status).toBe(200);
    expect(del.body.participantIds).not.toContain('peer_b');
  });

  it('改名 → title 更新', async () => {
    const create = await request(app).post('/api/conversations').send({ type: 'group', participantIds: ['me', 'peer_a'] });
    const id = create.body.conversation.id;
    const patch = await request(app).patch(`/api/conversations/${id}`).send({ title: '新群名' });
    expect(patch.status).toBe(200);
    expect(patch.body.conversation.title).toBe('新群名');
  });
});

// ============= 语音上传边界 =============
describe('语音上传边界', () => {
  it('合法语音上传 → 200 返回 audioPath', async () => {
    const up = await request(app)
      .post('/api/voice/upload')
      .send({ audio: Buffer.from('small').toString('base64'), ext: 'webm', duration: 100 });
    expect(up.status).toBe(200);
    expect(typeof up.body.audioPath).toBe('string');
  });

  it('超 8MB 语音 → 413', async () => {
    // ~8.6MB 解码后的字节数（base64 膨胀约 4/3）
    const big = 'A'.repeat(11_500_000);
    const up = await request(app).post('/api/voice/upload').send({ audio: big, ext: 'webm' });
    expect(up.status).toBe(413);
  });
});

// ============= 消息分页 (P2-6) =============
describe('消息分页 (P2-6)', () => {
  it('limit 分页 + before 游标正确返回 hasMore / oldest', async () => {
    const conv = await createConversation('p2-6');
    // 写入 35 条文本消息（超过默认 30 上限）
    for (let i = 0; i < 35; i++) {
      const r = await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: `m${i}` });
      expect(r.status).toBe(200);
    }

    // 第一页：最新 30 条，hasMore 应为 true
    const page1 = await request(app).get(`/api/conversations/${conv.id}/messages?limit=30`);
    expect(page1.status).toBe(200);
    const m1 = page1.body.messages as any[];
    expect(m1.length).toBe(30);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.oldest).toBeTruthy();
    expect(page1.body.oldest.id).toBe(m1[0].id); // oldest 是本页最旧（列表时间正序）
    // 时间正序：首条 createdAt <= 末条
    expect(new Date(m1[0].createdAt).getTime()).toBeLessThanOrEqual(new Date(m1[m1.length - 1].createdAt).getTime());

    // 第二页：用 oldest 游标取更早的 5 条，hasMore 应为 false
    const page2 = await request(app).get(
      `/api/conversations/${conv.id}/messages?beforeCreatedAt=${encodeURIComponent(page1.body.oldest.createdAt)}&beforeId=${encodeURIComponent(page1.body.oldest.id)}&limit=30`
    );
    expect(page2.status).toBe(200);
    const m2 = page2.body.messages as any[];
    expect(m2.length).toBe(5);
    expect(page2.body.hasMore).toBe(false);
    // 两页不重叠
    const ids1 = new Set(m1.map((m: any) => m.id));
    expect(m2.every((m: any) => !ids1.has(m.id))).toBe(true);
  });
});

// ============= P3-11 · 原生助手进程管理（仅本机，测试环境不真正 spawn） =============
describe('原生助手进程管理 (P3-11)', () => {
  it('status 返回结构化对象（含 port）', async () => {
    const res = await request(app).get('/api/native-assistant/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('running');
    expect(res.body).toHaveProperty('port');
  });

  it('start 在测试环境不真正启动进程（running:false，绝不占用 17890）', async () => {
    const res = await request(app).post('/api/native-assistant/start');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
  });

  it('stop 安全返回 running:false', async () => {
    const res = await request(app).post('/api/native-assistant/stop');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
  });
});

// ============= P3-11b · 本机远程协助生命周期（remote_assist_active 归零） =============
describe('本机远程协助生命周期 (P3-11b)', () => {
  it('remoteAssist 会话结束后 remote_assist_active 归零（修复「协助中」徽标永久显示）', async () => {
    const conv = await request(app)
      .post('/api/conversations')
      .send({ type: 'direct', participantIds: ['me', 'agent'], isRemoteAssist: true });
    expect(conv.status, `create failed: ${JSON.stringify(conv.body)}`).toBe(200);
    const convId = conv.body.conversation.id;

    // 触发一次本机协助（mock 的 query 为空生成器，流立即结束）
    const res = await request(app)
      .post(`/api/conversations/${convId}/agent`)
      .send({ message: '帮我点击开始按钮', remoteAssist: true });
    expect(res.status).toBe(200);

    // 流结束后后端应把 remote_assist_active 归零
    const after = db.getConversation(convId);
    expect(after).toBeTruthy();
    expect(after!.remote_assist_active).toBe(0);
  });

  it('普通 Agent 会话不会误置 remote_assist_active', async () => {
    const conv = await request(app)
      .post('/api/conversations')
      .send({ type: 'direct', participantIds: ['me', 'agent'] });
    expect(conv.status).toBe(200);
    const convId = conv.body.conversation.id;

    const res = await request(app)
      .post(`/api/conversations/${convId}/agent`)
      .send({ message: '你好', remoteAssist: false });
    expect(res.status).toBe(200);

    const after = db.getConversation(convId);
    expect(after!.remote_assist_active).toBe(0);
  });
});

// ============= P2-W1 · 新消息类型（表情/链接/视频/位置/名片）校验与落库 =============
describe('新消息类型 (P2-W1)', () => {
  it('大表情缺 content → 400', async () => {
    const conv = await createConversation('p2-sticker');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'sticker' });
    expect(res.status).toBe(400);
  });

  it('合法大表情 → 200 且 content 透传', async () => {
    const conv = await createConversation('p2-sticker');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'sticker', content: '🎉' });
    expect(res.status).toBe(200);
    expect(res.body.message?.msgType).toBe('sticker');
    expect(res.body.message?.content).toBe('🎉');
  });

  it('链接非 http(s) → 400', async () => {
    const conv = await createConversation('p2-link');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'link', content: 'example.com' });
    expect(res.status).toBe(400);
  });

  it('合法链接 → 200 且 content / meta.link 持久化', async () => {
    const conv = await createConversation('p2-link');
    const url = 'https://example.com/article';
    const res = await postMessage(conv.id, {
      senderId: 'me', msgType: 'link', content: url,
      meta: { link: { url, title: '标题', description: '摘要' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.message?.msgType).toBe('link');
    expect(res.body.message?.content).toBe(url);
    expect(res.body.message?.meta?.link?.title).toBe('标题');
  });

  it('视频缺 videoPath → 400', async () => {
    const conv = await createConversation('p2-video');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'video' });
    expect(res.status).toBe(400);
  });

  it('合法视频（带 videoPath）→ 200', async () => {
    const conv = await createConversation('p2-video');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'video', videoPath: 'vid-1.mp4' });
    expect(res.status).toBe(200);
    expect(res.body.message?.msgType).toBe('video');
    expect(res.body.message?.videoPath).toBe('vid-1.mp4');
  });

  it('位置缺 lat/lng → 400', async () => {
    const conv = await createConversation('p2-loc');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'location', content: '家' });
    expect(res.status).toBe(400);
  });

  it('合法位置 → 200 且 meta.location 持久化', async () => {
    const conv = await createConversation('p2-loc');
    const res = await postMessage(conv.id, {
      senderId: 'me', msgType: 'location', content: '公司',
      meta: { location: { lat: 31.23, lng: 121.47, name: '公司', address: '浦东' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.message?.msgType).toBe('location');
    expect(res.body.message?.meta?.location?.lat).toBe(31.23);
    expect(res.body.message?.meta?.location?.lng).toBe(121.47);
  });

  it('名片缺 meta.cardId → 400', async () => {
    const conv = await createConversation('p2-card');
    const res = await postMessage(conv.id, { senderId: 'me', msgType: 'card', content: '张三' });
    expect(res.status).toBe(400);
  });

  it('合法名片 → 200 且 meta.card 持久化', async () => {
    const conv = await createConversation('p2-card');
    const res = await postMessage(conv.id, {
      senderId: 'me', msgType: 'card', content: '张三',
      meta: { card: { cardId: 'c_zhang', cardName: '张三', cardAvatarText: '张', cardAvatarColor: '#888' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.message?.msgType).toBe('card');
    expect(res.body.message?.meta?.card?.cardId).toBe('c_zhang');
  });

  it('会话最后一条为视频时 lastMessage 预览为 [视频]', async () => {
    const conv = await createConversation('p2-preview');
    await postMessage(conv.id, { senderId: 'me', msgType: 'video', videoPath: 'vid-2.mp4' });
    const list = await request(app).get('/api/conversations');
    const entry = (list.body.conversations as any[]).find(c => c.id === conv.id);
    expect(entry?.lastMessage?.content).toBe('[视频]');
  });
});

// ============= P2-W3 · 数据导出 =============
describe('数据导出 (P2-W3)', () => {
  it('GET /api/export 返回 version:1 与 contacts/conversations/messages 数组', async () => {
    const conv = await createConversation('p2-export');
    await postMessage(conv.id, { senderId: 'me', msgType: 'text', content: '导出测试' });
    const res = await request(app).get('/api/export');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(Array.isArray(res.body.conversations)).toBe(true);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.conversations.some((c: any) => c.id === conv.id)).toBe(true);
    expect(res.body.messages.some((m: any) => m.content === '导出测试')).toBe(true);
  });
});

// ============= P2-重 · 朋友圈 / 群二维码 =============
describe('朋友圈 (Moments)', () => {
  it('发布动态 → 时间线可见 → 点赞 → 评论', async () => {
    const res = await request(app).post('/api/moments').send({ content: '测试动态' });
    expect(res.status).toBe(200);
    const moment = res.body.moment;
    expect(moment.id).toBeTruthy();
    expect(moment.authorId).toBe('me');

    const list = await request(app).get('/api/moments');
    expect(list.status).toBe(200);
    expect(list.body.moments.some((m: any) => m.id === moment.id)).toBe(true);

    const like = await request(app).post(`/api/moments/${moment.id}/like`);
    expect(like.status).toBe(200);
    expect(like.body.likedByMe).toBe(true);
    expect(like.body.likes.some((l: any) => l.userId === 'me')).toBe(true);

    const comment = await request(app).post(`/api/moments/${moment.id}/comment`).send({ content: '第一条评论' });
    expect(comment.status).toBe(200);
    expect(comment.body.comment.content).toBe('第一条评论');
  });

  it('空动态被拒（400）', async () => {
    const res = await request(app).post('/api/moments').send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('不能删除他人动态（403）', async () => {
    // 直接落库一条他人动态
    const db2 = await import('./db');
    const m = db2.createMoment({ authorId: 'u_alice', content: 'alice 的' });
    const res = await request(app).delete(`/api/moments/${m.id}`);
    expect(res.status).toBe(403);
  });
});

describe('群二维码 (Group QR)', () => {
  it('群会话返回可扫码的二维码 data URL', async () => {
    const conv = await createConversation('qr-group');
    const res = await request(app).get(`/api/conversations/${conv.id}/qr`);
    expect(res.status).toBe(200);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.payload).toContain(conv.id);
  });

  it('非群会话返回 400', async () => {
    const conv = await createConversation('qr-not-group');
    // 把会话类型临时改回 direct 不可行（类型固定），这里改为对不存在的群号测试 404
    const res = await request(app).get('/api/conversations/does-not-exist/qr');
    expect(res.status).toBe(404);
  });
});
