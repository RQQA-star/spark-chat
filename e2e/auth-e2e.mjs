// 前端访问令牌端到端冒烟（基于 playwright-core，绕过 @playwright/test 安装问题）。
// 验证 #91：配置 SPARK_ACCESS_TOKEN 后，前端能探测→弹窗→输入→刷新→带令牌加载数据；
// 同时回归无令牌模式不弹窗、现有功能不受 installAuthFetch 影响。
//
// 前置：容器内已 `npx playwright install --with-deps chromium` 且 playwright-core 已就位。
// 运行（应用监听 3000，容器内执行）：
//   无令牌模式：E2E_BASE=http://127.0.0.1:3000 node e2e/auth-e2e.mjs
//   带令牌模式：E2E_BASE=... E2E_MODE=token E2E_TOKEN=secret123 node e2e/auth-e2e.mjs
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const mode = process.env.E2E_MODE || 'notoken'; // 'notoken' | 'token'
const TOKEN = process.env.E2E_TOKEN || 'secret123';
const log = (...a) => console.log('[auth-e2e]', ...a);
const fails = [];

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  if (mode === 'token') {
    // 1) 初始应弹出「需要访问令牌」模态（服务端 tokenRequired=true 且本地无令牌）
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    try {
      await page.locator('text=需要访问令牌').first().waitFor({ timeout: 12000 });
      log('带 token 模式：检测到「需要访问令牌」模态');
    } catch {
      fails.push('带 token 模式未弹出「需要访问令牌」模态');
    }
    // 2) 输入令牌并提交（确认按钮 → setToken + reload）
    try {
      const input = page.locator('input[type="password"]').first();
      await input.fill(TOKEN);
      await page.locator('button:has-text("确认")').first().click();
      log('已输入令牌并点击「确认」');
    } catch (e) {
      fails.push('无法输入令牌 / 点击确认: ' + e.message);
    }
    // 3) reload 后模态应消失（localStorage 已有令牌）
    try {
      await page.locator('text=需要访问令牌').first().waitFor({ state: 'detached', timeout: 8000 });
      log('reload 后令牌模态消失');
    } catch {
      fails.push('reload 后令牌模态未消失（token 可能未生效）');
    }
    // 4) 数据应带令牌加载：切通讯录后 Alice 可见（/api/contacts 返回 200）
    try {
      await page.locator('text=通讯录').first().click({ timeout: 8000 });
      await page.locator('text=Alice').first().waitFor({ timeout: 12000 });
      log('带 token 模式：reload 后能加载联系人（API 携带令牌成功）');
    } catch (e) {
      fails.push('带 token 模式 reload 后无法加载联系人: ' + e.message);
    }
  } else {
    // 无令牌回归：复用 smoke 断言，并确认不弹窗（installAuthFetch 零副作用）
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    if (!/星火聊天/.test(title)) fails.push('title 缺少「星火聊天」: ' + title);
    try {
      await page.locator('text=星火助手').first().waitFor({ timeout: 12000 });
      log('种子会话「星火助手」可见');
    } catch {
      fails.push('种子会话「星火助手」未渲染');
    }
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    try {
      await page.locator('text=通讯录').first().click({ timeout: 8000 });
      log('已点击「通讯录」tab');
    } catch {
      fails.push('「通讯录」tab 不可点击');
    }
    for (const name of ['Alice', 'Bob', 'Carol']) {
      try {
        await page.locator('text=' + name).first().waitFor({ timeout: 12000 });
        log('联系人「' + name + '」可见');
      } catch {
        fails.push('联系人「' + name + '」未渲染');
      }
    }
    const modalCount = await page.locator('text=需要访问令牌').count();
    if (modalCount > 0) fails.push('无 token 模式误弹「需要访问令牌」模态');
    else log('无 token 模式：未弹出令牌模态（零副作用确认）');
  }

  await browser.close();
  if (fails.length) {
    console.error('AUTH-E2E FAILED:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('AUTH-E2E PASS (' + mode + ')');
}

main().catch((e) => { console.error('AUTH-E2E ERROR:', e); process.exit(2); });
