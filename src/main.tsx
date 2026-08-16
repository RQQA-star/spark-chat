import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { APP_CONFIG } from './config';
import { installAuthFetch } from './lib/auth';
import 'tdesign-react/esm/style/index.js';
import '@tdesign-react/chat/es/style/index.js';
import './index.css';

// 注入访问令牌到所有同源 /api 请求（若服务端启用了 SPARK_ACCESS_TOKEN）。
// 必须在任何组件发起请求前安装；未配置令牌时完全无副作用。
installAuthFetch();

// 设置页面标题
document.title = APP_CONFIG.name;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
