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

  const auditConv = 'remote-audit-test-conv';

  it('getAudit 记录 start/request/result/close 全周期', () => {
    const { sessionId } = remoteSession.createSession(auditConv);
    remoteSession.enqueueAction(auditConv, 'run_command', { command: 'echo hi' });
    const actions = remoteSession.fetchPendingActions(sessionId, '');
    remoteSession.submitResult(sessionId, actions[0].id, { ok: true, output: 'hi' });
    remoteSession.closeSession(auditConv);
    const audit = remoteSession.getAudit(sessionId);
    expect(audit.map((e) => e.kind)).toEqual(['start', 'request', 'result', 'close']);
    const reqEntry = audit.find((e) => e.kind === 'request');
    expect(reqEntry?.action).toBe('run_command');
    expect(reqEntry?.summary).toBe('echo hi');
    const resEntry = audit.find((e) => e.kind === 'result');
    expect(resEntry?.ok).toBe(true);
  });

  it('getAudit 对未知 sessionId 返回空数组', () => {
    expect(remoteSession.getAudit('no-such-session')).toEqual([]);
  });

  it('HTTP: GET /audit 对未知 sessionId 返回 200 与空数组', async () => {
    const r = await request(app).get('/api/remote/session/bad-id/audit');
    expect(r.status).toBe(200);
    expect(r.body.audit).toEqual([]);
  });

  it('write_file 审计摘要附带字节数', () => {
    const { sessionId } = remoteSession.createSession('remote-audit-write-conv');
    remoteSession.enqueueAction('remote-audit-write-conv', 'write_file', { path: 'C:\\Users\\me\\a.txt', content: 'hello' });
    const req = remoteSession.getAudit(sessionId).find((e) => e.kind === 'request');
    expect(req?.summary).toContain('(5 字节)');
    remoteSession.closeSession('remote-audit-write-conv');
  });
});
