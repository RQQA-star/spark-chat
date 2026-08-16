import { useState, useEffect } from 'react';
import { Dialog, Input, Button, Tag } from 'tdesign-react';
import { NotifState } from '../lib/notifications';

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  theme: string;
  onToggleTheme: () => void;
  notification?: { state: NotifState; onEnable: () => void };
}

export function SettingsPanel({ visible, onClose, theme, onToggleTheme, notification }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible) {
      fetch('/api/check-login').then(r => r.json()).then(setStatus).catch(() => {});
    }
  }, [visible]);

  const save = async () => {
    if (!apiKey && !authToken) return;
    const res = await fetch('/api/save-env-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey || undefined, authToken: authToken || undefined }),
    });
    const data = await res.json();
    setSaved(true);
    setStatus({ isLoggedIn: true, method: 'env' });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Dialog visible={visible} onClose={onClose} header="设置" width={480} footer={null}>
      <div className="space-y-5 py-1">
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>主题</span>
          <Button variant="outline" size="small" onClick={onToggleTheme}>
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </Button>
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>桌面通知</span>
            {notification && (
              notification.state === 'granted' ? (
                <Tag theme="success">已开启</Tag>
              ) : notification.state === 'denied' ? (
                <Tag theme="danger">已拒绝</Tag>
              ) : notification.state === 'unsupported' ? (
                <Tag theme="default">不支持</Tag>
              ) : (
                <Button size="small" theme="primary" variant="outline" onClick={notification.onEnable}>开启</Button>
              )
            )}
          </div>
          <div className="text-xs mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
            当群里有人 @ 我时，弹出系统通知；点击通知可跳转到对应会话。浏览器可能要求先授权。
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <div className="text-sm font-medium mb-1" style={{ color: 'var(--td-text-color-primary)' }}>CodeBuddy 凭证</div>
          <div className="text-xs mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
            与「星火助手」对话需要 CodeBuddy API Key / Auth Token。也可在终端执行 <code>codebuddy login</code>。
            配置仅对当前进程有效。
          </div>
          <div className="space-y-3">
            <Input value={apiKey} onChange={e => setApiKey(e as string)} placeholder="CODEBUDDY_API_KEY" />
            <Input value={authToken} onChange={e => setAuthToken(e as string)} placeholder="CODEBUDDY_AUTH_TOKEN" />
            <div className="flex items-center gap-3">
              <Button theme="primary" onClick={save} disabled={!apiKey && !authToken}>保存</Button>
              {saved && <Tag theme="success">已保存</Tag>}
            </div>
          </div>
          {status && (
            <div className="mt-3 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
              登录状态：
              {status.isLoggedIn
                ? <Tag theme="success" style={{ marginLeft: 6 }}>已登录（{status.method === 'env' ? '环境变量' : 'CLI'}）</Tag>
                : <Tag theme="warning" style={{ marginLeft: 6 }}>未登录</Tag>}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
