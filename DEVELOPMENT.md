# spark-chat 开发指南

微信风格的即时聊天 Web 应用，内置「星火助手」（CodeBuddy Agent），支持单聊 / 群聊 / 语音消息，并可发起本机远程协助让 AI 直接操作你的电脑。本文档面向二次开发，覆盖架构、API、实时同步与开发 / 测试 / 部署工作流。

> 目录
> - [技术栈](#技术栈)
> - [目录结构](#目录结构)
> - [数据模型](#数据模型)
> - [API 端点](#api-端点)
> - [WebSocket 实时同步](#websocket-实时同步)
> - [安全模型](#安全模型)
> - [Agent / 远程协助](#agent--远程协助)
> - [开发工作流](#开发工作流)
> - [测试](#测试)
> - [Docker 与部署](#docker-与部署)
> - [常见定制](#常见定制)

---

## 技术栈

**后端**
- Node.js 22 + Express（RESTful API）
- TypeScript（项目引用 `tsconfig.app.json` / `tsconfig.server.json` / `tsconfig.node.json`）
- better-sqlite3（SQLite，文件 `data/chat.db`）
- ws（WebSocket 实时同步 + 远程协助信令）
- @tencent-ai/agent-sdk（Agent 流式对话）

**前端**
- React 18 + TypeScript
- React Router（路由）
- TDesign React（`@tdesign-react/chat` 聊天组件 + `tdesign-react` 基础组件）
- Vite（构建 / 开发服务器，默认 5173，代理 `/api` 与 `/ws` 到 3000）

---

## 目录结构

```
spark-chat/
├─ server/
│  ├─ index.ts            # Express 入口：路由 + WebSocket + 鉴权 + 启动（导出 startServer）
│  ├─ db.ts               # better-sqlite3 数据层（会话/消息/联系人/成员）
│  ├─ security.ts         # 安全口径：isAllowedOrigin / isTokenValid / getAccessToken（HTTP 与 WS 共用）
│  ├─ remoteAssistTools.ts# 远程协助原生键鼠注入工具（经 ws://127.0.0.1:17890 转发）
│  ├─ *.test.ts           # 后端测试（vitest，node 环境）
│  └─ native-assistant/    # 本机原生协助进程（真实 OS 键鼠注入，Windows 原生依赖）
├─ src/
│  ├─ App.tsx             # 应用入口：组合各 Hook，挂载 Sidebar / ChatPage
│  ├─ types.ts            # 共享类型（Conversation / ConvMessage / Contact / PermissionRequest ...）
│  ├─ hooks/
│  │  ├─ useConversations.ts  # 会话列表（建群/改名/成员变更 + conversation:update 合并）
│  │  ├─ useMessages.ts       # 当前会话消息 + WebSocket 实时同步（message:new/read/typing/conversation:update）
│  │  ├─ useContacts.ts       # 联系人列表
│  │  ├─ useVoice.ts          # 录音（波形/振幅）+ Web Speech 语音转写
│  │  └─ useTheme.ts          # 深/浅色主题
│  ├─ components/
│  │  ├─ Sidebar.tsx          # 微信式侧边栏（会话/通讯录/设置）
│  │  ├─ ChatPage.tsx / ChatMessages.tsx / ChatInput.tsx / VoiceMessage.tsx
│  │  ├─ GroupManagePanel.tsx # 群管理：改名 / 加成员 / 移除成员
│  │  ├─ NewGroupDialog.tsx / AddContactDialog.tsx / EditContactDialog.tsx
│  │  ├─ RemoteAssistPanel.tsx# WebRTC 远程桌面双窗口（控制端 / 被控端）
│  │  ├─ AgentConfigDialog.tsx# Agent 配置（model / systemPrompt / permissionMode / cwd）
│  │  ├─ InlinePermissionCard.tsx # 权限确认卡片
│  │  └─ ErrorBoundary.tsx
│  └─ lib/notifications.ts # @ 提及桌面通知
├─ native-assistant/       # 原生助手（见 server/native-assistant）
├─ Dockerfile / docker-compose.yml / .dockerignore
├─ .github/workflows/ci.yml
└─ .smoke.mjs              # 容器内冒烟验证脚本（默认不打包进镜像）
```

---

## 数据模型

SQLite（`server/db.ts`，首次运行自动建表 + 种子数据：你、星火助手、Alice/Bob/Carol）。

- **conversations**：`id, type('direct'|'group'), title, avatar_text, avatar_color, is_remote_assist, remote_assist_active, created_at, updated_at`。序列化含 `participantIds`、`messageCount`、`lastMessage`。
- **messages**：`id, conversation_id, sender_id, msg_type('text'|'voice'|'image'|'agent'|'system'), content, transcript(语音转写), audio_path, image_path, duration, meta(JSON: mentions/quote), created_at, status`。
- **contacts**：`id, name, avatar_text, avatar_color, is_agent, agent_config(JSON: systemPrompt/permissionMode/model/cwd)`。
- **conversation_participants**：`conversation_id, contact_id`（群成员关系）。

---

## API 端点

所有 `/api/*` 请求在配置了 `SPARK_ACCESS_TOKEN` 时需带 `Authorization: Bearer <token>`；未配置则免鉴权（见[安全模型](#安全模型)）。以下为 REST 端点：

### 健康检查
```
GET /api/health                       → { status:'ok', timestamp }
```

### 登录 / 凭证
```
GET  /api/check-login                 → { isLoggedIn, method?, envConfigured?, cliConfigured?, apiKey? }
POST /api/save-env-config             body: { apiKey?, authToken?, internetEnv?, baseUrl? } → { success, message }
```
> 与「星火助手」对话需要 CodeBuddy 凭证：在设置里填 `CODEBUDDY_API_KEY` / `CODEBUDDY_AUTH_TOKEN`，或终端 `codebuddy login`。缺失时应用优雅降级提示，不会卡死。

### 模型
```
GET /api/models                       → { models:[{modelId,name,description?}], defaultModel }
```

### 联系人
```
GET    /api/contacts                  → { contacts:[Contact] }
POST   /api/contacts                  body: { name, isAgent?, agentConfig? } → { contact }
DELETE /api/contacts/:id              → { success }
PATCH  /api/contacts/:id              body: { name?, avatarText?, avatarColor?, agentConfig? } → { contact }
```

### 会话（单聊 / 群聊）
```
GET    /api/conversations             → { conversations:[Conversation] }
POST   /api/conversations             body: { type:'direct'|'group', participantIds:[string], title?, avatarText?, avatarColor?, isRemoteAssist? }
                                      → { conversation }（direct 已存在返回 existed）
GET    /api/conversations/:id         → { conversation }
PATCH  /api/conversations/:id         body: { title?, avatarText?, avatarColor? } → { success, conversation }
DELETE /api/conversations/:id         → { success }
```
> 改名 / 头像变更会通过 WebSocket 广播 `conversation:update`（见实时同步），多端实时刷新。

### 群成员
```
POST   /api/conversations/:id/participants        body: { contactId } → { participantIds:[string] }
DELETE /api/conversations/:id/participants/:cid   → { success, participantIds:[string] }
```
> 加 / 移除成员同样广播 `conversation:update`。

### 消息
```
GET    /api/conversations/:id/messages?limit=30&beforeCreatedAt=&beforeId=   → { messages:[ConvMessage], hasMore, oldest }
POST   /api/conversations/:id/messages         body: { senderId, msgType, content?, transcript?, audioPath?, imagePath?, duration?, meta? }
                                                       → { message }（clientId 即消息 id，天然去重）
DELETE /api/conversations/:id/messages/:msgId  → { success }
DELETE /api/conversations/:id/messages         → { success }（清空会话）
GET    /api/messages/search?q=                 → { messages:[ConvMessage] }
```

### 语音 / 图片上传
```
POST /api/voice/upload      body: { audio(base64), duration, ext? } → { audioPath }（上限 ~8MB，超出 413）
GET  /api/voice/:file       → 音频文件流
POST /api/image/upload      body: { image(base64), ext? } → { imagePath }
GET  /api/image/:file       → 图片文件流
```

### Agent 对话（SSE 流式）
```
POST /api/conversations/:id/agent   body: { message, model?, systemPrompt?, permissionMode?, cwd?, remoteAssist? }
                                    → Server-Sent Events：
                                      type:'text'|'tool'|'tool_result'|'permission_request'|'done'|'error'
POST /api/permission-response       body: { requestId, behavior:'allow'|'deny', message? } → { success }
```
> 前端在 `useMessages.sendToAgent` 中逐行解析 `data:` 块，流式渲染文本 / 工具调用 / 权限卡片。

### 原生助手（本机远程协助）
```
GET  /api/native-assistant/status   → { running:boolean, port:17890 }
POST /api/native-assistant/start    → 拉起本机原生助手进程
POST /api/native-assistant/stop     → 停止进程
```

### 远程桌面信令（WebRTC HTTP 轮询）
```
POST /api/remote/room                       body: { role:'controller' } → { roomCode, peerId }
POST /api/remote/room/:code/join            body: {} → { role:'controlled', controllerPeerId }
GET  /api/remote/room/:code/signal          → 轮询 offer/answer/ice（按 role/peer 返回）
POST /api/remote/room/:code/signal          body: { type:'offer'|'answer'|'ice', from, to, payload }
```

---

## WebSocket 实时同步

路径：`ws://<host>:3000/ws?conversationId=<id>`（鉴权时附加 `&token=<SPARK_ACCESS_TOKEN>`）。按 `conversationId` 分房间订阅。

**服务端 → 客户端（广播）**
| 事件 | 负载 | 说明 |
|------|------|------|
| `message:new` | `{ message, clientId }` | 新消息到达（含自己发的，幂等补齐） |
| `message:read` | `{ conversationId }` | 对方已读，刷新「已读」回执 |
| `typing` | `{ senderId, typing }` | 输入中指示（非自己） |
| `conversation:update` | `{ conversation }` | 群名/头像/成员变更，实时刷新侧边栏与聊天头 |

**客户端 → 服务端**
| 事件 | 负载 | 说明 |
|------|------|------|
| `typing` | `{ senderId, typing }` | 上报输入状态，服务端转发给同房间其他端 |

> 前端在 `useMessages` 中处理上述事件；`conversation:update` 经 `onConversationUpdate` → `useConversations.applyConversationUpdate` 合并进会话列表，实现跨客户端实时同步。断线自动指数退避重连。

---

## 安全模型

集中在 `server/security.ts`，HTTP 中间件与 WebSocket `verifyClient` 共用同一口径：

1. **来源校验（S3）**：请求 `Origin` 必须是本机地址——`localhost`、`127.0.0.1`、`[::1]`、HTTPS 同主机、以及原生助手端口 `127.0.0.1:17890`；外部来源（`evil.com`、内网 IP 等）一律拒绝。
2. **访问令牌（G3）**：若配置了 `SPARK_ACCESS_TOKEN`（非空），所有 `/api` 与 WS 请求必须携带正确的 `Authorization: Bearer <token>`；未配置则不强制（本地开发免鉴权）。
3. **绑定地址**：默认仅绑 `127.0.0.1`（本机安全）；容器化或对外暴露时通过 `HOST=0.0.0.0` 放开。

### 生产健壮性加固（零新依赖）

实现集中在 `server/hardening.ts`（中间件）与 `server/index.ts`（信号处理）：

```ts
app.use(securityHeaders);        // 全响应：X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP
app.use('/api', rateLimit());    // 按 IP 内存窗口（60s/200），/api/health 免限流，超限 429
```

- **优雅停机**：`server/index.ts` 在 `NODE_ENV !== 'test'` 时注册 `SIGINT`/`SIGTERM` 处理器，先同步写 stderr 日志（避免 `process.exit` 截断），再 `shutdownServer()` 关闭 WS 客户端、`closeAllConnections()`、`http.Server.close()`、`db.closeDb()` 与后台定时器，最后 `process.exit(0)`。
- **Docker 信号陷阱**：`Dockerfile` 的 `CMD` 必须为 `node --import tsx server/index.ts`，让 node 成为 PID 1 才能收到 `SIGTERM`；`npx tsx` 会让 npm 当 PID 1、吞掉信号，导致编排器拿到非 0 退出码、优雅停机失效。

---

## Agent / 远程协助

- **星火助手（Agent）**：对话走 `@tencent-ai/agent-sdk` 的 `query()`，SSE 流式返回文本 / 工具调用 / 权限请求；`permissionMode` 取自联系人 `agentConfig`（`default` / `acceptEdits` / `plan` / `bypassPermissions`）。
- **本机远程协助**：`remoteAssist:true` 时把 `inject_input` 工具（move/down/up/drag/wheel/key/type，坐标 0~1 归一化）挂到 SDK MCP Server，handler 经 `ws://127.0.0.1:17890` 转发给原生助手注入真实 OS 键鼠。**需在本机 Windows 安装原生依赖并运行助手进程**（容器内不含原生依赖，故容器内 `running` 恒为 false）。
- **WebRTC 远程桌面**：后端提供 HTTP 轮询信令（建房间 / 加入 / offer/answer/ice）；前端双窗口（控制端 / 被控端）经 `RTCPeerConnection` + STUN 直连，控制事件走 `RTCDataChannel('control')`。同房间号双标签页可自连验证；真正的跨机控制需被控端运行原生协助进程注入输入。

---

## 开发工作流

```bash
npm install --legacy-peer-deps           # 依赖较多，建议加 --prefer-offline 提速
npm run dev                              # 同时起后端(3000) 与前端(5173)
# 打开 http://localhost:5173
```

分开启动：
```bash
npm run dev:server   # tsx watch server/index.ts  -> http://localhost:3000
npm run dev:client   # vite                        -> http://localhost:5173
```

构建：
```bash
npm run build        # tsc -b && vite build  → dist/
npm run typecheck    # tsc -b（项目引用）
```

> 后端使用 SQLite（`data/chat.db`），首次运行自动写入种子数据。删除 `data/chat.db` 可重置。

---

## 测试

使用 vitest（node 环境跑后端、jsdom 环境跑前端；jsdom 为 Vitest 内置环境，跨平台稳健）。`@tdesign-react/chat` 在测试中别名到轻量桩以加速、避免加载整条重型 web-components 依赖。

```bash
npm test             # vitest run（71 测试：server 50 + 前端 21）
npm run test:watch   # vitest 监听
```

`server/index.ts` 导出 `startServer(port, host)` 供集成测试起临时端口 + 真实 `ws` 客户端；测试通过 `vi.mock('@tencent-ai/agent-sdk')` 桩掉 Agent。

**冒烟（容器内）**：`.smoke.mjs` 覆盖健康检查、鉴权、联系人、模型、语音转写、远程信令、群管理链路等 16 项检查。容器内运行：
```bash
BASE=http://127.0.0.1:3000 TOKEN=<SPARK_ACCESS_TOKEN> node .smoke.mjs
```

### 端到端（Playwright）

`e2e/smoke.spec.ts` 为 Playwright 冒烟用例，`playwright.config.ts` 已配置（`testDir: ./e2e`，不自动拉起服务，针对已运行实例）。因本机杀软会间歇锁定 `node_modules`，推荐在 Docker 容器内跑。

> **关键**：E2E 容器**不要**设 `SPARK_ACCESS_TOKEN`（前端不发令牌，设了反而 401）。

**标准流程（需 npm registry 可达）：**

```bash
npm install                       # 拉取 @playwright/test
npx playwright install chromium   # 浏览器二进制（容器内需 --with-deps 装系统库）
docker run -d --name spark-e2e -p 3200:3000 -e HOST=0.0.0.0 spark-chat:latest
E2E_BASE=http://127.0.0.1:3200 npm run e2e
docker rm -f spark-e2e
```

**本机受限兜底（`e2e/smoke.mjs`，用 npx 缓存里的 `playwright-core` 直接驱动 chromium）：**

```bash
# 容器内注入 e2e 文件后：
E2E_BASE=http://127.0.0.1:3000 node e2e/smoke.mjs
```

> 坑：`docker cp` 在 Git Bash 下对**含中文的路径**会解析失败；改用 `tar -c -C <源目录> e2e | docker exec -i <容器> tar -x -C /app` 管道拷贝。

选择器基于稳定文本（页面标题、种子会话「星火助手」、种子联系人 Alice/Bob/Carol），不依赖易变 DOM。

---

## Docker 与部署

多阶段镜像：`node:22-bookworm`（builder，安装依赖 + 类型检查 + 测试 + 构建）→ `node:22-bookworm-slim`（runtime，仅 `tsx server/index.ts`）。生产由后端托管前端 `dist/`。

```bash
# 构建
DOCKER_BUILDKIT=0 docker build -t spark-chat:latest .
# 运行（对外暴露需 HOST=0.0.0.0；建议设置访问令牌）
docker run -d --name spark-chat -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e SPARK_ACCESS_TOKEN=<your-token> \
  -v $(pwd)/data:/app/data \
  spark-chat:latest
```

`docker-compose.yml` 已提供等价编排（含 `SPARK_ACCESS_TOKEN` 与数据卷）。

> **注意**：本机若遇 Buildx `buildx\.lock` 访问拒绝，使用 `DOCKER_BUILDKIT=0` 退回到 legacy builder（Windows MSYS 环境已知问题）。
> `data/`、`.smoke.mjs`、`*.log`、`vitest.config.ts.timestamp-*.mjs` 等已在 `.dockerignore` 排除，不打包进镜像。

**CI**：`.github/workflows/ci.yml` 在 push/PR 到 `main` 时执行 `npm install --legacy-peer-deps` → `npm run typecheck` → `npm test` → `npm run build`。

---

## 常见定制

### 修改默认模型
编辑 `server/index.ts` 中的 `defaultModel`（或每个联系人的 `agentConfig.model`）。

### 修改端口
`PORT` 环境变量（`server/index.ts` 读取）；前端 `vite.config.ts` 的 `/api`、`/ws` 代理同步改。

### 关闭 / 开启访问令牌
设置 / 取消环境变量 `SPARK_ACCESS_TOKEN`；设置后所有 HTTP 与 WS 必须带 `Bearer` 令牌。

### 清空所有数据
删除 `data/chat.db`（或调用各 `DELETE` 端点）。

### 扩展 API
在 `server/index.ts` 增加 `app.get/post/...` 路由，并在 `server/db.ts` 增加数据层函数；如需实时同步，调用 `wsBroadcast(conversationId, { type, ... })`。

---

## 参考

- [CodeBuddy Agent SDK](https://codebuddy.tencent.com)
- [Express](https://expressjs.com/)
- [TDesign React](https://tdesign.tencent.com/react/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [ws](https://github.com/websockets/ws)
- [Server-Sent Events 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
