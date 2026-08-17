# 星火聊天 (spark-chat)

微信风格的即时聊天 Web 应用，内置「星火助手」(CodeBuddy Agent)，支持单聊 / 群聊 / 语音消息。其主线是**跨机远程协助（P2P AI 动手）**：A 的电脑遇到 AI / 配置问题，B 可直接用**自己的 AI** 远程对接、操作 A 的电脑去设置 AI / 改配置。微信风聊天只是壳，聊天的本质是「玩 AI」。

## 功能

- **单聊 / 群聊**：与联系人、AI 助手聊天；群聊支持成员管理与改名。
- **语音消息**：基于 `MediaRecorder` 录音，播放带波形进度；录音可取消。
- **群管理**：添加 / 移除成员、修改群名称，变更经 WebSocket 实时广播到所有打开该群的客户端（跨端同步）。
- **联系人管理**：搜索、添加、删除联系人。
- **星火助手（Agent）**：对话走 CodeBuddy Agent SDK 流式响应，支持工具调用与权限确认卡片。
- **跨机远程协助（AI 动手）**：微信风聊天是壳，远程协助才是主线。
  - *跨机通道*：被控端（A）在会话点「发起远程协助」→ 后端建 session；A 的浏览器把控制端（B 的星火助手）下发的指令经本机原生助手（`ws://127.0.0.1:17890`）真实执行并回传。服务器中转，**无需 TURN/STUN 穿透**，B 的 AI 只要在同源会话即可远程操作 A 的电脑。
  - *安全闸*：每条指令弹窗经 A 本人「允许 / 拒绝」；危险命令（`rm -rf` / `format` / `shutdown` / `sudo` / `dd` / 写系统目录等）默认自动拒绝；全部操作落服务端 SQLite 审计账本，进程重启仍可查。
  - *本机协助*（演示级）：Agent 以 `bypassPermissions` 在本机执行命令 / 读写文件，立即可用但不跨机。
  - *远程桌面*（架构预埋）：WebRTC 屏幕共享 + 控制信令链路，同房间号双标签页可自连验证；真·键鼠注入需被控端运行原生协助进程。
- **工程细节**：深色 / 浅色主题、错误边界、未读红点、日期分隔、消息删除 / 清空。

## 运行

```bash
npm install --legacy-peer-deps   # 依赖较多，建议加 --prefer-offline 提速
npm run dev                      # 同时启动后端(3000) 与前端(5173)
# 打开 http://localhost:5173
```

> 要求 Node.js 22（仓库已含 `.nvmrc`，`nvm use` 即可切换）。

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
│  ├─ index.ts        # 路由：会话/消息/联系人/语音/Agent 流式/跨机远程协助
│  ├─ remoteSession.ts# 远程协助 session 注册表 + action 中继 + 审计
│  ├─ remoteAssistTools.ts # 星火助手 remote_action 工具（run_command/read_file/write_file）
│  └─ db.ts           # better-sqlite3 数据层（含 remote_audit 表）
├─ src/
│  ├─ pages/ChatPage.tsx
│  ├─ components/     # Sidebar / ChatMessages / ChatInput / VoiceMessage
│  │                  # GroupManagePanel / AddContactDialog / RemoteAssistPanel / RemoteAssistSession
│  │                  # InlinePermissionCard / ErrorBoundary ...
│  ├─ hooks/          # useConversations / useMessages / useContacts / useVoice / useTheme
│  └─ types.ts
└─ vite.config.ts     # /api 代理到 3000
```

## 测试

使用 vitest：`npm test`（当前 **117 测试**，12 文件；后端集成 + 前端 jsdom）。`server/index.ts` 导出 `startServer(port, host)` 供集成测试起临时端口 + 真实 `ws` 客户端。

## 跨机远程协助（AI 动手）

这是 spark-chat 的主线能力：**A 的电脑有问题，B 用自己的星火助手远程操作 A 的机器**。微信风聊天只是壳，远程协助通道才是产品本体。

### 架构（服务器中转，无 TURN/STUN）

```
被控端 A                             服务器（中转）                      控制端 B（星火助手）
─────────                          ────────────                       ──────────────────
会话点「发起远程协助」  ─POST─▶  建 session（按 conversationId）
起 native-assistant            │
 :17890 已连           │
轮询 GET /actions ─每1.2s─▶ 取 B 下发的指令（run_command/read_file/write_file）
  │                              │
  └─▶ 转发本机原生助手执行 ──┐     │
       结果 POST /result ─────┘▶  唤醒挂起 promise（30s 超时）
                                          │
                           B 的 remote_action 工具 ◀── 结果回显给 B
```

B 的 AI 只要在**与 A 同一会话**里即可获得 `remote_action` 工具；工具仅在 A 已发起活跃 session 时挂载，无需任何 P2P 穿透。

### 安全模型（被控端主导）

- **确认闸**：每条指令弹窗经 A 本人「允许 / 拒绝」，绝不静默执行。
- **危险命令自动拒绝**：命中 `rm -rf` / `format` / `shutdown` / `del /f` / `sudo` / `dd if=` / fork bomb，或 `write_file` 写向系统目录（`C:\Windows...`、`/etc`、`/usr` 等）时直接拒绝。
- **服务端审计账本**：`remote_audit` 表记录 `start / request / result / close` 四类事件，含指令摘要（`write_file` 仅记路径+字节数，不落文件内容）；进程重启仍可查，被控端面板可拉 `GET /api/remote/session/:id/audit` 或 `GET /api/remote/audit?conversationId=` 查看。

### 实操（两台机器）

**被控端 A**
1. `npm run dev` → 进入与 B 的会话 → 点顶部 **🛠 发起远程协助** → 弹窗内点「发起」。
2. 被控机启动真正执行命令的原生助手：
   ```bash
   cd native-assistant && npm install && npm start   # 监听 ws://127.0.0.1:17890
   ```
   面板显示「原生助手已连接」即就绪。

**控制端 B**
1. 同一会话打开星火助手，对 AI 说「帮对方运行 ipconfig 念给我」「读一下对方 C:\Users\me\config.json」等。
2. A 机器弹出**确认框** → 点「允许执行」→ 结果经服务器回传 B。

> 命令延迟约一个轮询周期（1.2s），排障够用。真·跨机：把服务部署到可达机器（或 `docker pull` ② 推送的 GHCR 镜像自托管），A、B 各连同一服务，流程一致。

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
- 跨机远程协助（`remote_action`）**已可用**：被控端发起 + 启动本机 `native-assistant` 后，控制端星火助手即可在同会话远程跑命令 / 读写文件，操作经被控端确认闸 + 服务端审计账本留存。WebRTC 远程桌面仍属架构预埋 / 演示级，真·键鼠注入需被控端运行原生协助进程。
- 本机远程协助的真·键鼠注入依赖本机 Windows 原生助手（`native-assistant/`，需 `@nut-tree-fork/nut-js` 等原生依赖）与 CodeBuddy CLI 对 SDK MCP Server 的支持——容器内不含原生依赖，`/api/native-assistant/status` 的 `running` 恒为 `false` 属预期。
- Agent 凭证缺失时仅做降级提示，不会真正调用模型。
- 语音转写依赖浏览器 Web Speech API（Chrome / Edge 中文支持最佳），不支持时静默降级为无转写。
