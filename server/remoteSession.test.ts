import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index.js';
import * as remoteSession from './remoteSession.js';

describe('跨机远程协助 · action 中继（服务端中转）', () => {
  const conversationId = 'remote-session-test-conv';

  it('createSession 后 getSessionIdByConversation 可查回，close 后失效', () => {
    const { sessionId } = remoteSession.createSession(conversationId);
    expect(sessionId).toBeTruthy();
    expect(remoteSession.getSessionIdByConversation(conversationId)).toBe(sessionId);
    remoteSession.closeSession(conversationId);
    expect(remoteSession.getSessionIdByConversation(conversationId)).toBeNull();
  });

  it('enqueueAction → fetchPendingActions → submitResult 全链路闭环', async () => {
    const { sessionId } = remoteSession.createSession(conversationId);
    const pending = remoteSession.enqueueAction(conversationId, 'run_command', { command: 'echo hi' });
    const actions = remoteSession.fetchPendingActions(sessionId, '');
    expect(actions.length).toBe(1);
    const actionId = actions[0].id;
    const submitRes = remoteSession.submitResult(sessionId, actionId, { ok: true, output: 'hi' });
    expect(submitRes).toBe(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hi');
    remoteSession.closeSession(conversationId);
  });

  it('submitResult 对未知 actionId 返回 false', () => {
    expect(remoteSession.submitResult('nope', 'nope', { ok: true })).toBe(false);
  });

  it('HTTP: 缺少 conversationId 创建 session 返回 400', async () => {
    const r = await request(app).post('/api/remote/session').send({});
    expect(r.status).toBe(400);
  });

  it('HTTP: 不存在的会话创建 session 返回 404', async () => {
    const r = await request(app).post('/api/remote/session').send({ conversationId: 'does-not-exist-xyz' });
    expect(r.status).toBe(404);
  });

  it('HTTP: actions / result 端点对非法 sessionId 安全返回', async () => {
    const a = await request(app).get('/api/remote/session/bad-id/actions');
    expect(a.status).toBe(200);
    expect(a.body.actions).toEqual([]);
    const r = await request(app).post('/api/remote/session/bad-id/result').send({ actionId: 'x' });
    expect(r.status).toBe(404);
  });
});
