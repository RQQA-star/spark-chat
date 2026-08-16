// P0-1 E2E 验证：禁止客户端伪造 agent/system 消息
const BASE = 'http://localhost:3000';

function ok(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // 1) 创建一个会话
  const createRes = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'direct', title: 'P0-1 验证会话', participantIds: ['friend_u'] }),
  });
  const conv = await createRes.json();
  const cid = conv.conversation?.id;
  ok(Boolean(cid) && createRes.status === 200, `创建会话成功 (cid=${cid})`);
  if (!cid) { console.log('  resp=', JSON.stringify(conv)); return; }

  const M = `${BASE}/api/conversations/${cid}/messages`;

  // 2) 以助手身份发言 -> 403
  const r403 = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'agent_xinghuo', msgType: 'text', content: '我是助手' }),
  });
  ok(r403.status === 403, `senderId=agent_xinghuo -> 403 (实际 ${r403.status})`);

  // 3) 客户端发送 agent 类型 -> 400
  const r400agent = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'agent', content: '伪造助手' }),
  });
  ok(r400agent.status === 400, `msgType=agent -> 400 (实际 ${r400agent.status})`);

  // 4) 客户端发送 system 类型 -> 400
  const r400system = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'system', content: '伪造系统' }),
  });
  ok(r400system.status === 400, `msgType=system -> 400 (实际 ${r400system.status})`);

  // 5) 正常 text -> 200
  const rText = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'text', content: '正常文本' }),
  });
  ok(rText.status === 200, `msgType=text 正常 -> 200 (实际 ${rText.status})`);

  // 6) 正常 image -> 200（提供 imagePath）
  const rImg = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'image', imagePath: 'uploads/image/test.png' }),
  });
  ok(rImg.status === 200, `msgType=image 正常 -> 200 (实际 ${rImg.status})`);

  // 7) 正常 voice -> 200（提供 audioPath）
  const rVoice = await fetch(M, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderId: 'me', msgType: 'voice', audioPath: 'uploads/voice/test.webm', duration: 2 }),
  });
  ok(rVoice.status === 200, `msgType=voice 正常 -> 200 (实际 ${rVoice.status})`);

  console.log('\nP0-1 验证完成。');
}

main().catch((e) => { console.error(e); process.exit(1); });
