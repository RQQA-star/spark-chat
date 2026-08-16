import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

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

export default defineConfig({
  plugins: [tsJsResolver(), react()],
  resolve: {
    alias: {
      // react/react-dom/scheduler 强制别名到项目自身副本，避免双 React 实例导致 "Invalid hook call"
      react: path.resolve('node_modules/react'),
      'react-dom': path.resolve('node_modules/react-dom'),
      scheduler: path.resolve('node_modules/scheduler'),
      // 用轻量桩替换重型 @tdesign-react/chat（依赖 tdesign-web-components 链），
      // 使 ChatMessages 测试无需加载整条依赖即可断言文本。
      '@tdesign-react/chat': path.resolve('src/test/stubs/tdesign-react-chat.tsx'),
    },
  },
  test: {
    // 关闭结果/转换缓存：缓存默认落到 node_modules/.vite，会被杀软 EPERM 锁。
    cache: false,
    globals: true,
    // 标准 jsdom 环境（Vitest 内置，跨平台稳健）。
    // 服务端测试文件用 `// @vitest-environment node` 覆盖回 node。
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['./server/test-setup.ts', './src/test/setup.ts'],
    // 不预打包第三方组件库，避免 optimizeDeps 扫描其重型 web-components 链
    deps: {
      inline: ['@tdesign-react/chat'],
    },
  },
});
