// 朋友圈 / 群二维码 / 视频通话 端到端冒烟（基于 playwright-core，与 auth-e2e.mjs 同模式）。
// 浏览器驱动真实 UI，断言三块 P2 功能的可达性与核心渲染：
//   1) 朋友圈：点击导航 → MomentsPage 发布框可见
//   2) 视频通话：打开会话 → 点击「视频」→ VideoCallDialog（本地模拟）可见 → 挂断
//   3) 群二维码：API 建群 → 重载使侧栏出现该群 → 群管理 → 群二维码弹窗渲染 data: URL 图片
//
// 前置：容器内已 `npx playwright install --with-deps chromium` 且 playwright-core 已就位。
// 运行（应用监听 3000）：E2E_BASE=http://127.0.0.1:3000 node e2e/features-e2e.mjs
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const log = (...a) => console.log('[features-e2e]', ...a);
const fails = [];

async function check(name, fn) {
  try {
    await fn();
    log('✓', name);
  } catch (e) {
    fails.push(name + ': ' + (e && e.message ? e.message : e));
    log('✗', name, e && e.message ? e.message : e);
  }
}

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  // 预置：通过真实 API 建一个群（群二维码测试依赖群会话）。
  // 建群后需重载页面，让前端重新拉取会话列表、侧栏才会出现该群。
  let groupTitle = null;
  try {
    const cRes = await fetch(base + '/api/contacts');
    const cJson = await cRes.json();
    const list = Array.isArray(cJson) ? cJson : (cJson.contacts || []);
    const others = list.filter((c) => c.id !== 'me').slice(0, 2).map((c) => c.id);
    groupTitle = 'E2E测试群_' + Date.now();
    const gRes = await fetch(base + '/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'group', participantIds: others, title: groupTitle }),
    });
    if (!gRes.ok) throw new Error('建群 HTTP ' + gRes.status);
    log('已建群：', groupTitle);
  } catch (e) {
    fails.push('建群失败: ' + (e && e.message ? e.message : e));
    log('✗ 建群失败', e && e.message ? e.message : e);
  }

  // 1) 朋友圈
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await check('打开朋友圈页', async () => {
    await page.locator('button[title="朋友圈"]').first().click();
    await page.getByPlaceholder('这一刻的想法…').first().waitFor({ timeout: 12000 });
  });
  await check('返回聊天视图', async () => {
    await page.locator('button[title="聊天"]').first().click();
  });

  // 2) 视频通话（任意会话均可，用种子「星火助手」）
  await check('打开会话并拨打视频通话', async () => {
    await page.locator('text=星火助手').first().click({ timeout: 12000 });
    await page.getByRole('button', { name: '视频' }).first().click({ timeout: 8000 });
    await page.locator('text=本地模拟通话（演示）').first().waitFor({ timeout: 8000 });
  });
  await check('挂断视频通话', async () => {
    await page.locator('button[title="挂断"]').first().click();
    await page.waitForTimeout(800); // 等 dialog 关闭动画
  });

  // 3) 群二维码（依赖上面建好的群）
  if (groupTitle) {
    await check('打开群并展示群二维码', async () => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' }); // 重载使新群进入侧栏
      await page.locator('text=' + groupTitle).first().click({ timeout: 12000 });
      await page.getByRole('button', { name: '群管理' }).first().click({ timeout: 8000 });
      await page.locator('text=群聊管理').first().waitFor({ timeout: 8000 });
      await page.getByRole('button', { name: '群二维码（邀请）' }).first().click({ timeout: 8000 });
      await page.locator('text=群二维码').first().waitFor({ timeout: 8000 });
      await page.locator('img[src^="data:image/png;base64,"]').first().waitFor({ timeout: 8000 });
    });
  }

  await browser.close();
  if (fails.length) {
    console.error('FEATURES-E2E FAILED:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('FEATURES-E2E PASS');
}

main().catch((e) => { console.error('FEATURES-E2E ERROR:', e); process.exit(2); });
