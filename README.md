# 星火聊天 (spark-chat)

微信风格的即时聊天 Web 应用，内置「星火助手」(CodeBuddy Agent)，支持单聊 / 群聊 / 语音消息，并可发起**本机远程协助**让 AI 直接操作你的电脑。

## 功能

- **单聊 / 群聊**：与联系人、AI 助手聊天；群聊支持成员管理与改名。
- **语音消息**：基于 `MediaRecorder` 录音，播放带波形进度；录音可取消。
- **群管理**：添加 / 移除成员、修改群名称，变更经 WebSocket 实时广播到所有打开该群的客户端（跨端同步）。
- **联系人管理**：搜索、添加、删除联系人。
- **星火助手（Agent）**：对话走 CodeBuddy Agent SDK 流式响应，支持工具调用与权限确认卡片。
- **远程协助**：
  - *本机协助*：让 Agent 以 `bypassPermissions` 在本机执行命令 / 读写文件（演示级，立即可用）。
  - *远程桌面*：WebRTC 屏幕共享 + 控制信令链路预埋（同房间号双标签页可自连验证；真正的跨机控制需在被控端运行原生协助进程）。
- **工程细节**：深色 / 浅色主题、错误边界、未读红点、日期分隔、消息删除 / 清空。

## 运行

```bash
npm install --legacy-peer-deps   # 依赖较多，建议加 --prefer-offline 提速
npm run dev                      # 同时启动后端(3000) 与前端(5173)
# 打开 http://localhost:5173
```

也可分开启动：

```bash
npm run dev:server   # tsx server/index.ts  -> http://localhost:3000
npm run dev:client   # vite                  -> http://localhost:5173
```

> 后端使用 SQLite (`data/chat.db`)，首次运行自动写入种子数据（你、星火助手、Alice/Bob/Carol）。

## 配置 CodeBuddy 凭证

与「星火助手」对话 / 发起本机协助需要 CodeBuddy 凭证，二选一：

1. 打开应用右上角「设置」填入 `CODEBUDDY_API_KEY` 或 `CODEBUDDY_AUTH_TOKEN`（仅当前进程有效）；
2. 或在终端执行 `codebuddy login`。

未配置时，应用会优雅降级：聊天里给出明确引导，而不会卡死。

## 目录结构

```
spark-chat/
├─ server/            # Express 后端 + SQLite
│  ├─ index.ts        # 路由：会话/消息/联系人/语音/Agent 流式/远程信令
│  └─ db.ts           # better-sqlite3 数据层
├─ src/
│  ├─ pages/ChatPage.tsx
│  ├─ components/     # Sidebar / ChatMessages / ChatInput / VoiceMessage
│  │                  # GroupManagePanel / AddContactDialog / RemoteAssistPanel
│  │                  # InlinePermissionCard / ErrorBoundary ...
│  ├─ hooks/          # useConversations / useMessages / useContacts / useVoice / useTheme
│  └─ types.ts
└─ vite.config.ts     # /api 代理到 3000
```

## 测试

使用 vitest：`npm test`（71 测试，后端 50 + 前端 21）。后端在 `node` 环境、前端在自定义 jsdom 环境（规避本机杀软对 `node_modules/jsdom` 的锁定）。`server/index.ts` 导出 `startServer(port, host)` 供集成测试起临时端口 + 真实 `ws` 客户端。

```bash
npm test           # vitest run
npm run test:watch
```

容器内冒烟（`.smoke.mjs`，16 项：鉴权 / 联系人 / 模型 / 语音转写 / 远程信令 / 群管理链路）：

```bash
BASE=http://127.0.0.1:3000 TOKEN=<SPARK_ACCESS_TOKEN> node .smoke.mjs
```

## 端到端测试（Playwright）

`e2e/smoke.spec.ts` 为 Playwright 冒烟用例（配置 `playwright.config.ts`，`testDir: ./e2e`）。E2E 针对**已运行的实例**执行（推荐 Docker 容器，规避本机杀软对 `node_modules` 的锁定）。

> **关键**：E2E 容器**不要**设置 `SPARK_ACCESS_TOKEN`。前端不发送令牌，服务端「未配置令牌则一律通过（免鉴权）」（`server/security.ts:42`），设了令牌反而让前端 API 全 401、页面渲染不出数据。

### 标准流程（需 npm registry 可达）

```bash
# 1. 安装 @playwright/test 与 chromium 浏览器（仅需一次）
npm install                       # 拉取 @playwright/test（已在 devDependencies）
npx playwright install chromium   # 浏览器二进制（容器内需 --with-deps 装系统库）

# 2. 起「无令牌」容器作为运行实例
docker run -d --name spark-e2e -p 3200:3000 -e HOST=0.0.0.0 spark-chat:latest

# 3. 跑 E2E（指向容器端口；容器内 root 跑 chromium 需 --no-sandbox，配置已含）
E2E_BASE=http://127.0.0.1:3200 npm run e2e

# 4. 清理
docker rm -f spark-e2e
```

### 本机受限环境的兜底（`e2e/smoke.mjs`）

本机杀软会锁 `node_modules` 导致 `npm install` 失败；部分容器内 npm registry 也不可达，使 `@playwright/test` 装不上。此时用已随 `npx playwright install` 进入 npx 缓存的 `playwright-core` 直接驱动 chromium：

```bash
# 容器内（已装好 chromium + 系统依赖）注入 e2e 文件后直接跑：
E2E_BASE=http://127.0.0.1:3000 node e2e/smoke.mjs
```

> 注意：`docker cp` 在 Git Bash 下对**含中文的路径**会解析失败（被错写成 `d:\d\聊天`）。改用 `tar` 管道：`tar -c -C <源目录> e2e | docker exec -i <容器> tar -x -C /app`。

> `playwright.config.ts` 不自动拉起服务；`E2E_BASE` 可覆盖目标地址（默认 `http://127.0.0.1:3200`）。产物 `test-results/` `playwright-report/` 已在 `.gitignore` 忽略。

## 实时同步（WebSocket）

打开会话即建立 `ws://<host>:3000/ws?conversationId=<id>` 连接（鉴权时加 `&token=`）。服务端向同房间广播：

- `message:new` —— 新消息（含自己发的，幂等补齐）
- `message:read` —— 对方已读回执
- `typing` —— 输入中指示
- `conversation:update` —— 群名 / 头像 / 成员变更（多端实时刷新侧边栏与聊天头）

客户端上报 `typing` 会转发给同房间其他端。断线自动重连。详见 [`DEVELOPMENT.md`](./DEVELOPMENT.md#websocket-实时同步)。

## 安全模型

集中在 `server/security.ts`，HTTP 与 WebSocket 共用：

1. **来源校验**：请求 `Origin` 须为本机（`localhost` / `127.0.0.1` / `[::1]` / 原生助手端口 `17890`），外部来源拒绝。
2. **访问令牌**：设置 `SPARK_ACCESS_TOKEN` 后，所有 `/api` 与 WS 须带 `Authorization: Bearer <token>`；未设置则本地免鉴权。
3. **绑定地址**：默认仅绑 `127.0.0.1`；容器化对外暴露需 `HOST=0.0.0.0`。

## 生产健壮性加固

零新依赖（杀软锁 npm 环境下不引入第三方包），由 `server/hardening.ts` + `server/index.ts` 实现：

1. **安全响应头**（等价于 helmet 子集，作用于所有响应）：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-DNS-Prefetch-Control: off`、`Permissions-Policy` 限制敏感特性，以及适度宽松的 `Content-Security-Policy`（仅允许同源脚本/样式，为 TDesign 保留 `unsafe-inline`，允许 `data:`/`blob:` 图片与 `ws:`/`wss:` 连接）。
2. **基础限流**：`/api` 按 IP 内存固定窗口（默认 60s / 200 次），超出返回 **429**；`/api/health` 存活探针跳过限流；过期桶自动清理。
3. **优雅停机**：监听 `SIGINT`/`SIGTERM`，依次关闭 WebSocket 客户端、`closeAllConnections()`、`http.Server.close()` 与 SQLite（`db.closeDb()`），并清理后台定时器，最后 `process.exit(0)`，避免连接/文件句柄泄漏导致退出码非 0。

> **Docker 信号**：`Dockerfile` 的 `CMD` 必须为 `node --import tsx server/index.ts`，让 **node 成为 PID 1** 才能收到 `SIGTERM`；若用 `npx tsx`，PID 1 是 npm 包装进程、不会转发信号，优雅停机与编排器的退出码判定都会失效。

## Docker 部署

多阶段镜像（构建期 `node:22-bookworm` 跑类型检查 + 测试 + 构建，运行时 `node:22-bookworm-slim` 仅 `tsx server/index.ts`，并由后端托管前端 `dist/`）：

```bash
DOCKER_BUILDKIT=0 docker build -t spark-chat:latest .   # 本机遇 Buildx lock 拒绝时用 DOCKER_BUILDKIT=0
docker run -d --name spark-chat -p 3000:3000 \
  -e HOST=0.0.0.0 -e SPARK_ACCESS_TOKEN=<your-token> \
  -v $(pwd)/data:/app/data spark-chat:latest
```

> **前端访问令牌**：一旦设置 `SPARK_ACCESS_TOKEN`，所有 `/api` 与 `/ws` 都必须携带令牌。前端启动会探测（`GET /api/auth/config`）并弹出「输入访问令牌」界面，令牌仅保存在本机浏览器 `localStorage`，输入后自动为所有请求附加 `Authorization: Bearer` 与 WS `?token=`。不设该变量则完全免鉴权（本机开发默认）。

`docker-compose.yml` 提供等价编排。CI（`.github/workflows/ci.yml`）在 push/PR 到 `main` 时执行 `install → typecheck → test → build`。

## 已知范围

- **群聊多端同步已可用**：改名 / 加成员 / 移除成员经 WebSocket `conversation:update` 实时广播，多标签页 / 多设备打开同一群会即时刷新。
- 远程桌面为**架构预埋 / 演示级**：单实例原型可验证 WebRTC 与控制信令链路，同房间号双标签页可自连；真正跨机控制需被控端运行原生协助进程注入输入。
- 本机远程协助的真·键鼠注入依赖本机 Windows 原生助手（`native-assistant/`，需 `@nut-tree-fork/nut-js` 等原生依赖）与 CodeBuddy CLI 对 SDK MCP Server 的支持——容器内不含原生依赖，`/api/native-assistant/status` 的 `running` 恒为 `false` 属预期。
- Agent 凭证缺失时仅做降级提示，不会真正调用模型。
- 语音转写依赖浏览器 Web Speech API（Chrome / Edge 中文支持最佳），不支持时静默降级为无转写。
