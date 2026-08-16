// 独立 E2E 冒烟脚本（绕过 @playwright/test 安装问题，直接用 playwright-core）。
// 适用场景：当 @playwright/test 无法经 npm 安装（如容器内 npm registry 不可达）时，
// 用已随 `npx playwright install` 进入 npx 缓存的 playwright-core 直接驱动 chromium。
//
// 前置：容器内已执行 `npx playwright install --with-deps chromium`。
// 运行（容器内，应用监听 3000）：
//   E2E_BASE=http://127.0.0.1:3000 node e2e/smoke.mjs
//
// 正常环境请优先用 Playwright 测试运行器：npm run e2e（见 README/DEVELOPMENT）。
import { chromium } from 'playwright-core';

const base = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const log = (...a) => console.log('[e2e]', ...a);

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const fails = [];

  // 1) 文档标题（index.html 固定为「星火聊天」）
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  log('document.title =', JSON.stringify(title));
  if (!/星火聊天/.test(title)) fails.push('title 缺少「星火聊天」: ' + title);

  // 2) 默认「会话」tab 渲染种子会话「星火助手」（后端 API + SQLite 种子 + React 链路）
  try {
    await page.locator('text=星火助手').first().waitFor({ timeout: 12000 });
    log('种子会话「星火助手」可见');
  } catch (e) {
    fails.push('种子会话「星火助手」未渲染');
  }

  // 3) 切到「通讯录」tab，渲染种子联系人 Alice / Bob / Carol
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  try {
    await page.locator('text=通讯录').first().click({ timeout: 8000 });
    log('已点击「通讯录」tab');
  } catch (e) {
    fails.push('「通讯录」tab 不可点击');
  }
  for (const name of ['Alice', 'Bob', 'Carol']) {
    try {
      await page.locator('text=' + name).first().waitFor({ timeout: 12000 });
      log('联系人「' + name + '」可见');
    } catch (e) {
      fails.push('联系人「' + name + '」未渲染');
    }
  }

  await browser.close();
  if (fails.length) {
    console.error('E2E FAILED:\n - ' + fails.join('\n - '));
    process.exit(1);
  }
  console.log('E2E PASS: 全部冒烟断言通过');
}

main().catch((e) => { console.error('E2E ERROR:', e); process.exit(2); });
