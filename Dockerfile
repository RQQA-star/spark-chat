# ============================================================
# 星火聊天 (spark-chat) 多阶段镜像
# - builder：完整依赖 + 类型检查 + 测试 + 前端构建
# - runtime：仅运行所需文件，用 tsx 直接运行 TS 后端
# better-sqlite3 为原生模块，在 builder（Debian bookworm，glibc 2.36）
# 构建/下载预编译包，runtime 同为 bookworm-slim，ABI 与 glibc 兼容。
# ============================================================

# ---------------- 构建阶段 ----------------
FROM node:22-bookworm AS builder

WORKDIR /app

# 先复制依赖清单以利用层缓存（.npmrc 统一 legacy-peer-deps）
COPY package.json package-lock.json .npmrc ./

# 安装完整依赖（含 dev，用于 typecheck / test / tsx 运行）
# 注：使用 npm install 而非 npm ci，因为本机杀软会锁 npm 缓存导致无法在本地重新生成
# 完整的 package-lock；容器内网络可用、无杀软，npm install 可正常解析 @testing-library 等依赖。
RUN npm install --legacy-peer-deps

# 复制源码与配置（重目录已由 .dockerignore 排除）
COPY . .

# 质量门禁：类型检查 → 测试 → 前端构建
RUN npm run typecheck
RUN npm test
RUN npm run build

# ---------------- 运行阶段 ----------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# 仅复制运行所需产物（better-sqlite3 原生 .node 一并带入，ABI 兼容）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/native-assistant ./native-assistant
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/.npmrc ./.npmrc
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.server.json ./tsconfig.server.json
# 以下三项被 tsconfig.json 的 references 引用（tsc -b 走入口配置），
# 运行时镜像补全它们，避免在容器内/ad-hoc 跑 `tsc -b`/`vitest` 时因缺文件报 TS5083/TS18003。
COPY --from=builder /app/tsconfig.app.json ./tsconfig.app.json
COPY --from=builder /app/tsconfig.node.json ./tsconfig.node.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts

# SQLite 数据目录（db.ts 会按需创建，这里显式建好并作为卷挂载点）
RUN mkdir -p /app/data

# 以非 root 用户运行（node:22-bookworm-slim 自带 uid 1000 的 node 用户），
# 降低容器逃逸风险。compose 用 named volume spark-data 挂载 /app/data，
# 该卷会继承镜像内 /app/data 的所有权，SQLite 写入不受影响。
RUN chown -R node:node /app
USER node

EXPOSE 3000

# 后端通过 tsx 直接运行 TS；应用自身仅绑定 127.0.0.1，
# 容器端口 3000 由 docker-compose 决定对外暴露范围。
# 注意：必须用 `node --import tsx` 让 node 成为 PID 1，
# 否则 npx/npm 作为 PID 1 不会把 SIGTERM 转发给 node，导致优雅停机失效、退出码非 0。
CMD ["node", "--import", "tsx", "server/index.ts"]
