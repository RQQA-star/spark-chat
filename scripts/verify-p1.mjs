// P1-3 / P1-4 / P1-5 E2E 验证
const BASE = 'http://localhost:3000';
function ok(cond, label) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) process.exitCode = 1; }
const j = (r) => r.json();

async function main() {
  // ---- P1-5：聚合会话列表字段 ----
  const listRes = await fetch(`${BASE}/api/conversations`);
  const list = await j(listRes);
  ok(listRes.status === 200 && Array.isArray(list.conversations), 'GET /api/conversations 返回数组');
  const sample = list.conversations[0];
  ok(sample && typeof sample.messageCount === 'number', '会话含 messageCount（聚合）');
  ok(sample && typeof sample.unreadCount === 'number', '会话含 unreadCount（聚合）');
  ok(sample && Array.isArray(sample.participantIds), '会话含 participantIds 数组（聚合）');
  ok(sample && sample.lastMessage && sample.lastMessage.msgType, '会话含 lastMessage 预览（聚合）');

  // ---- P1-3：删除消息回收独占媒体文件 ----
  const createRes = await fetch(`${BASE}/api/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'direct', participantIds: ['u_alice'] }),
  });
  const conv = (await j(createRes)).conversation;
  const cid = conv.id;

  // 上传一个真实语音文件
  const tinyB64 = Buffer.from('RIFF....fakewebm').toString('base64');
  const up = await fetch(`${BASE}/api/voice/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: tinyB64, duration: 1, ext: 'webm' }),
  });
  const upJson = await j(up);
  const fname = upJson.audioPath;
  ok(up.status === 200 && typeof fname === 'string', `语音上传成功 (file=${fname})`);

  // 文件应当存在
  const before = await fetch(`${BASE}/api/voice/${fname}`);
  ok(before.status === 200, '上传后媒体文件可访问 (200)');

  // 发一条引用该文件的语音消息
  const msgRes = await fetch(`${BASE}/api/conversations/${cid}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'voice', audioPath: fname, duration: 1 }),
  });
  const msg = (await j(msgRes)).message;

  // 删除该消息 -> 文件应被回收
  const del = await fetch(`${BASE}/api/conversations/${cid}/messages/${msg.id}`, { method: 'DELETE' });
  ok(del.status === 200, '删除消息成功 (200)');
  const after = await fetch(`${BASE}/api/voice/${fname}`);
  ok(after.status === 404, '删除消息后独占媒体文件被回收 (404)');

  // ---- P1-3：引用计数——共享文件不应被误删 ----
  const up2 = await fetch(`${BASE}/api/voice/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: tinyB64, duration: 1, ext: 'webm' }),
  });
  const sharedName = (await j(up2)).audioPath;
  // 在两个会话中各发一条引用同一文件
  const cA = (await j(await fetch(`${BASE}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'direct', participantIds: ['u_bob'] }) }))).conversation;
  const cB = (await j(await fetch(`${BASE}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'direct', participantIds: ['u_carol'] }) }))).conversation;
  const mA = (await j(await fetch(`${BASE}/api/conversations/${cA.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senderId: 'me', msgType: 'voice', audioPath: sharedName, duration: 1 }) }))).message;
  const mB = (await j(await fetch(`${BASE}/api/conversations/${cB.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senderId: 'me', msgType: 'voice', audioPath: sharedName, duration: 1 }) }))).message;
  // 删掉其中一条 -> 文件仍在（被另一条引用）
  await fetch(`${BASE}/api/conversations/${cA.id}/messages/${mA.id}`, { method: 'DELETE' });
  const stillThere = await fetch(`${BASE}/api/voice/${sharedName}`);
  ok(stillThere.status === 200, '共享引用时删除一条不误删文件 (仍 200)');
  // 删掉第二条 -> 文件回收
  await fetch(`${BASE}/api/conversations/${cB.id}/messages/${mB.id}`, { method: 'DELETE' });
  const goneNow = await fetch(`${BASE}/api/voice/${sharedName}`);
  ok(goneNow.status === 404, '共享引用全部删除后媒体文件被回收 (404)');

  console.log('\nP1 验证完成。');
}
main().catch((e) => { console.error(e); process.exit(1); });
