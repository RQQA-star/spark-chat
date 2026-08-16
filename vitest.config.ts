import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 兜底：runtime 镜像（Dockerfile）把 NODE_ENV 烧成 production，
// 在其中直接跑 `npm test` 会让 React 走生产构建，
// 导致 @testing-library/react 的 act() 报 "not supported in production builds"。
// vitest 仅在 NODE_ENV 未设置时默认置为 test；这里对 production 镜像补一道兜底。
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_ENV = 'test';
}

// 服务端源码用 ESM ".js" 相对路径引用 .ts 文件（tsx/NodeNext 风格）。
// Vite 默认解析器不会把 "./db.js" 映射到 "./db.ts"，这里补一个最小插件，
// 仅在 .js 文件不存在、对应 .ts 存在时改写为 .ts，不影响裸模块（如 agent-sdk）。
function tsJsResolver() {
  return {
    name: 'ts-js-resolver',
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith('.')) return null;
      if (!source.endsWith('.js')) return null;
      const resolved = path.resolve(path.dirname(importer), source);
      const tsPath = resolved.replace(/\.js$/, '.ts');
      if (fs.existsSync(tsPath)) return tsPath;
      return null;
    },
  };
}

const ROOT = path.resolve(__dirname);
// 自定义 jsdom 环境模块：必须用【绝对路径】指定。
// 注意：vitest 对 environment 的相对路径（"./src/..."）在部分环境下（如容器内运行时镜像）
// 不会按 config 目录解析，会静默回退到 node 环境导致 "document is not defined"。
// 用 import.meta.url 推导绝对路径可跨平台稳健解析。
const JSDOM_ENV = fileURLToPath(new URL('./src/test/jsdom-env.mjs', import.meta.url));
// 隔离依赖目录（仅在本机 Windows + 杀软环境下存在；CI/Linux 上不存在则自动忽略）：
// - D:/spark-jsdom/pkgs        : jsdom 及其全部依赖（平铺，良好副本，位于项目【外部】以避 node_modules 向上解析命中损坏副本）
// - D:/spark-test-deps/node_modules : @testing-library/* 等
// 自适应：仅当目录真实存在才纳入解析路径；CI 容器内用标准 node_modules 副本即可。
const ISOLATED_JSDOM = path.resolve('D:/spark-jsdom/pkgs');
const ISOLATED_TEST_DEPS = path.resolve('D:/spark-test-deps/node_modules');
const USE_ISOLATED_JSDOM = fs.existsSync(path.join(ISOLATED_JSDOM, 'jsdom'));
const ISOLATED_DIRS = [ISOLATED_JSDOM, ISOLATED_TEST_DEPS].filter((p) => fs.existsSync(p));

// 仅在启用隔离 jsdom 时，把 jsdom 别名到外部副本，并设置 NODE_PATH 供其平铺依赖解析。
const jsdomAlias = USE_ISOLATED_JSDOM
  ? { jsdom: path.join(ISOLATED_JSDOM, 'jsdom') }
  : {};
const isolatedEnv = USE_ISOLATED_JSDOM ? { NODE_PATH: ISOLATED_JSDOM } : {};

export default defineConfig({
  plugins: [tsJsResolver(), react()],
  // 允许 vite 读取隔离目录中的依赖（默认只允许项目根与 node_modules）。
  server: {
    fs: {
      allow: [ROOT, ...ISOLATED_DIRS],
    },
  },
  resolve: {
    modules: ['node_modules', ...ISOLATED_DIRS],
    alias: {
      // react/react-dom/scheduler 强制别名到项目自身副本，避免双 React 实例导致 "Invalid hook call"
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
      scheduler: path.resolve('node_modules/scheduler'),
      // jsdom 别名到项目外部的良好副本（仅本机杀软损坏项目内 node_modules/jsdom 时启用）
      ...jsdomAlias,
      // 用轻量桩替换重型 @tdesign-react/chat（依赖 tdesign-web-components 链），
      // 使 ChatMessages 测试无需加载整条依赖即可断言文本。
      '@tdesign-react/chat': path.resolve('src/test/stubs/tdesign-react-chat.tsx'),
    },
  },
  test: {
    // 关闭结果/转换缓存：缓存默认落到 node_modules/.vite，会被杀软 EPERM 锁。
    cache: false,
    // 让 worker 进程能解析「项目外部平铺 jsdom」副本的内部依赖（其依赖靠 NODE_PATH 查找）。
    // 仅本机隔离模式设置；CI/Linux 用标准 node_modules 副本无需此变量。
    env: {
      ...isolatedEnv,
    },
    globals: true,
    // 默认 jsdom 环境（自定义模块，优先用项目外部良好 jsdom 副本，否则回退标准 jsdom）。
    // 服务端测试文件用 `// @vitest-environment node` 覆盖回 node。
    environment: JSDOM_ENV,
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['./server/test-setup.ts', './src/test/setup.ts'],
    // 不预打包第三方组件库，避免 optimizeDeps 扫描其重型 web-components 链
    deps: {
      inline: ['@tdesign-react/chat'],
    },
  },
});
