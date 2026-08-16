import { defineConfig } from '@playwright/test';

// E2E 针对「已运行的 spark-chat 实例」执行（推荐 Docker 容器，避免本机杀软对 node_modules 的锁定）。
// 启动容器后运行：
//   docker run -d --name spark-e2e -p 3200:3000 -e HOST=0.0.0.0 -e SPARK_ACCESS_TOKEN=smoke123 spark-chat:latest
//   E2E_BASE=http://127.0.0.1:3200 npm run e2e
//   docker rm -f spark-e2e
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3200';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    headless: true,
    // 容器内以 root 运行 chromium 必须加 --no-sandbox，否则启动即失败。
    launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // 不在此自动拉起服务（本机 dev 受 node_modules 锁限制），由上面的容器命令提供运行实例。
});
