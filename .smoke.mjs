// spark-chat #10 运行时冒烟验证
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const TOKEN = process.env.TOKEN || 'smoke123';

async function j(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE + url, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { try { body = await res.text(); } catch {} }
  return { status: res.status, body };
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
}

const auth = { Authorization: `Bearer ${TOKEN}` };

// 1. 健康检查（预期公开 200）
const health = await j('/api/health');
check('health public 200', health.status === 200, `status=${health.status}`);

// 2. 鉴权：无 token 访问 /api/conversations 预期 401
const noAuth = await j('/api/conversations');
check('conversations no-token 401', noAuth.status === 401, `status=${noAuth.status}`);

// 3. 鉴权：带 token 访问 /api/conversations 预期 200
const conv = await j('/api/conversations', { headers: auth });
check('conversations with-token 200', conv.status === 200, `status=${conv.status}`);

// 4. 联系人列表（带 token）
const contacts = await j('/api/contacts', { headers: auth });
check('contacts list 200', contacts.status === 200 && Array.isArray(contacts.body?.contacts), `status=${contacts.status}, n=${(contacts.body?.contacts||[]).length}`);

// 5. 模型列表（带 token）
const models = await j('/api/models', { headers: auth });
check('models list 200', models.status === 200 && Array.isArray(models.body?.models), `status=${models.status}, n=${(models.body?.models||[]).length}`);

// 6. 原生助手状态端点（#11 本机远程协助）
const nat = await j('/api/native-assistant/status', { headers: auth });
check('native-assistant status 200', nat.status === 200 && typeof nat.body?.running === 'boolean' && nat.body?.port === 17890,
  `status=${nat.status}, running=${nat.body?.running}, port=${nat.body?.port}`);

// 6. PATCH /api/contacts/:id —— #10 核心新端点
const first = (contacts.body?.contacts || [])[0];
if (first) {
  const patch = await j(`/api/contacts/${first.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ agentConfig: { systemPrompt: '冒烟测试提示词', permissionMode: 'plan', model: 'claude-sonnet-4' } }),
  });
  const cfg = patch.body?.contact?.agentConfig;
  check('PATCH contact agentConfig 200',
    patch.status === 200 && cfg && cfg.permissionMode === 'plan' && cfg.systemPrompt === '冒烟测试提示词',
    `status=${patch.status}, cfg=${JSON.stringify(cfg)}`);
  // 还原：清空 agentConfig，避免污染数据
  await j(`/api/contacts/${first.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ agentConfig: null }) });
} else {
  check('PATCH contact agentConfig 200', false, '无联系人可测');
}

// 7. PATCH 校验：agentConfig 非对象应 400
if (first) {
  const bad = await j(`/api/contacts/${first.id}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ agentConfig: 'not-object' }),
  });
  check('PATCH bad agentConfig 400', bad.status === 400, `status=${bad.status}`);
  await j(`/api/contacts/${first.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ agentConfig: null }) });
}

// 8. #7 语音消息 + 语音转文字 transcript 链路验证
const convList = (conv.body?.conversations || []);
const targetConv = convList[0];
if (targetConv) {
  const SENT_TRANSCRIPT = '这是语音转写冒烟测试-' + Date.now();
  const post = await j(`/api/conversations/${targetConv.id}/messages`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      senderId: 'me', msgType: 'voice',
      audioPath: 'smoke-test.webm', duration: 1234, transcript: SENT_TRANSCRIPT,
    }),
  });
  const gotTranscript = post.body?.message?.transcript;
  check('POST voice msg with transcript 200',
    post.status === 200 && gotTranscript === SENT_TRANSCRIPT,
    `status=${post.status}, transcript=${JSON.stringify(gotTranscript)}`);
  // 从 GET 消息列表回读，确认 transcript 已持久化
  const msgs = await j(`/api/conversations/${targetConv.id}/messages?limit=5`, { headers: auth });
  const found = (msgs.body?.messages || []).find(m => m.transcript === SENT_TRANSCRIPT);
  check('GET messages returns transcript',
    msgs.status === 200 && !!found,
    `status=${msgs.status}, found=${!!found}`);
} else {
  check('POST voice msg with transcript 200', false, '无会话可测');
  check('GET messages returns transcript', false, '无会话可测');
}

// 9. #12 WebRTC 远程桌面信令端点（房间创建 + 加入配对）
const rcreate = await j('/api/remote/room', { method: 'POST', headers: auth, body: JSON.stringify({ role: 'controller' }) });
const rcode = rcreate.body?.roomCode;
const rpeer = rcreate.body?.peerId;
check('POST /api/remote/room 200', rcreate.status === 200 && !!rcode, `status=${rcreate.status}, code=${rcode}`);
if (rcode) {
  const rjoin = await j(`/api/remote/room/${rcode}/join`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
  check('POST /api/remote/room/:code/join 200',
    rjoin.status === 200 && rjoin.body?.role === 'controlled' && rjoin.body?.controllerPeerId === rpeer,
    `status=${rjoin.status}, role=${rjoin.body?.role}, ctrlPeerOk=${rjoin.body?.controllerPeerId === rpeer}`);
} else {
  check('POST /api/remote/room/:code/join 200', false, '无房间码可测');
}

// 10. #6 群聊管理链路：建群 / 加成员 / 改名 / 移除成员
const gcreate = await j('/api/conversations', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ type: 'group', participantIds: ['me', 'peer_a'], title: '冒烟测试群' }),
});
const gid = gcreate.body?.conversation?.id;
check('POST /api/conversations 建群 200',
  gcreate.status === 200 && !!gid && gcreate.body?.conversation?.type === 'group',
  `status=${gcreate.status}, id=${gid}`);
if (gid) {
  // 加成员
  const gadd = await j(`/api/conversations/${gid}/participants`, {
    method: 'POST', headers: auth, body: JSON.stringify({ contactId: 'peer_b' }),
  });
  check('POST participants 加成员 200 含新成员',
    gadd.status === 200 && Array.isArray(gadd.body?.participantIds) && gadd.body.participantIds.includes('peer_b'),
    `status=${gadd.status}, ids=${JSON.stringify(gadd.body?.participantIds)}`);

  // 改名
  const grename = await j(`/api/conversations/${gid}`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ title: '冒烟改名群' }),
  });
  check('PATCH 改名 200 标题更新',
    grename.status === 200 && grename.body?.conversation?.title === '冒烟改名群',
    `status=${grename.status}, title=${grename.body?.conversation?.title}`);

  // 移除成员
  const gdel = await j(`/api/conversations/${gid}/participants/peer_b`, {
    method: 'DELETE', headers: auth,
  });
  check('DELETE participants 移除成员 200 缩减',
    gdel.status === 200 && Array.isArray(gdel.body?.participantIds) && !gdel.body.participantIds.includes('peer_b'),
    `status=${gdel.status}, ids=${JSON.stringify(gdel.body?.participantIds)}`);

  // 回收测试数据：删除该群（避免污染数据）
  await j(`/api/conversations/${gid}`, { method: 'DELETE', headers: auth });
} else {
  check('POST participants 加成员 200 含新成员', false, '无群可测');
  check('PATCH 改名 200 标题更新', false, '无群可测');
  check('DELETE participants 移除成员 200 缩减', false, '无群可测');
}

const failed = results.filter(r => !r.ok);
console.log(`\n==== 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ====`);
process.exit(failed.length ? 1 : 0);
