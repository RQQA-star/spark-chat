import { test, expect } from '@playwright/test';

// 端到端冒烟：验证「后端 API + SQLite 种子 + React 渲染 + TDesign」全链路在运行实例中可用。
// 选择器均基于稳定文本（页面标题、种子会话/联系人），不依赖易变的内部 DOM 结构。
// 注意：Sidebar 默认 tab 为「会话」，种子联系人仅在「通讯录」tab 可见。

test.describe('spark-chat 端到端冒烟', () => {
  test('默认会话页加载且渲染种子会话（全栈通路）', async ({ page }) => {
    await page.goto('/');

    // 1) 文档标题（index.html 固定为「星火聊天」）
    await expect(page).toHaveTitle(/星火聊天/);

    // 2) 默认「会话」tab 展示种子会话（db.ts 种子建了与「星火助手」的 direct 会话）
    //    证明：后端 /api/conversations 正常、SQLite 种子已写入、React 已渲染。
    await expect(page.getByText(/星火助手/)).toBeVisible();
  });

  test('通讯录页渲染种子联系人（联系人链路）', async ({ page }) => {
    await page.goto('/');

    // 切到「通讯录」tab（Sidebar 中 <Users /> 通讯录 按钮）
    await page.getByText('通讯录', { exact: true }).click();

    // 种子联系人：Alice / Bob / Carol（db.ts 种子）
    await expect(page.getByText('Alice', { exact: true })).toBeVisible();
    await expect(page.getByText('Bob', { exact: true })).toBeVisible();
    await expect(page.getByText('Carol', { exact: true })).toBeVisible();
  });
});
