import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  },
  build: {
    // 单包 2.65MB 体积告警消除 + 改善首屏缓存：按 vendor 拆分。
    // react / tdesign / agent-sdk 各自成块，其余第三方归 vendor，应用代码独立。
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|history)[\\/]/.test(id)) return 'react-vendor';
          if (/[\\/]node_modules[\\/]@tdesign/.test(id)) return 'tdesign-vendor';
          if (/[\\/]node_modules[\\/]@tencent-ai/.test(id)) return 'agent-vendor';
          if (/[\\/]node_modules[\\/](@tanstack|@floating-ui|dayjs|lodash|marked|markdown|highlight\.js|cherry-markdown|mermaid|katex|ahooks)[\\/]/.test(id)) return 'ui-vendor';
          return 'vendor';
        },
      },
    },
  },
});
