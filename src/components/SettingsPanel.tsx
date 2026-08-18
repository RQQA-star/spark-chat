import { useState, useEffect, useRef } from 'react';
import { Dialog, Input, Button, Tag, Slider } from 'tdesign-react';
import { NotifState } from '../lib/notifications';
import { ChatBackground, CHAT_BG_PRESETS } from '../hooks/useSettings';

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  theme: string;
  onToggleTheme: () => void;
  notification?: { state: NotifState; onEnable: () => void };
  fontScale?: number;
  onFontScale?: (scale: number) => void;
  chatBg?: ChatBackground;
  onChatBg?: (bg: ChatBackground) => void;
}

export function SettingsPanel({ visible, onClose, theme, onToggleTheme, notification, fontScale = 1, onFontScale, chatBg, onChatBg }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const bgImgRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      fetch('/api/check-login').then(r => r.json()).then(setStatus).catch(() => {});
    }
  }, [visible]);

  // 卸载时清理「已保存」提示计时器，避免对已卸载组件 setState
  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);

  const save = async () => {
    if (!apiKey && !authToken) return;
    const res = await fetch('/api/save-env-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKey || undefined, authToken: authToken || undefined }),
    });
    const data = await res.json();
    setSaved(true);
    setStatus({ isLoggedIn: true, method: 'env' });
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => setSaved(false), 2000);
  };

  const handleBgImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        onChatBg?.({ type: 'image', value: dataUrl });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleExport = async () => {
    try {
      const res = await fetch('/api/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spark-chat-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('导出失败', e);
    }
  };

  const isPresetActive = (value: string) =>
    chatBg?.type === 'color' && (chatBg.value || '') === value;
  const isImageActive = chatBg?.type === 'image' && !!chatBg.value;

  return (
    <Dialog visible={visible} onClose={onClose} header="设置" width={480} footer={null}>
      <div className="space-y-5 py-1">
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>主题</span>
          <Button variant="outline" size="small" onClick={onToggleTheme}>
            {theme === 'dark' ? '切换到浅色' : '切换到深色'}
          </Button>
        </div>

        {/* 字体大小 */}
        <div className="border-t pt-4" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>字体大小</span>
            <span className="text-xs" style={{ color: 'var(--td-text-color-placeholder)' }}>{Math.round(fontScale * 100)}%</span>
          </div>
          <Slider value={fontScale} min={0.8} max={1.4} step={0.05} onChange={(v) => onFontScale?.(Number(v))} />
          <div className="flex items-center justify-between mt-2">
            <span className="text-sm" style={{ fontSize: `calc(15px * ${fontScale})`, color: 'var(--td-text-color-secondary)' }}>聊天字体预览 Aa</span>
            <Button size="small" variant="text" onClick={() => onFontScale?.(1)} disabled={fontScale === 1}>重置</Button>
          </div>
        </div>

        {/* 聊天背景 */}
        <div className="border-t pt-4" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <div className="text-sm font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>聊天背景</div>
          <div className="flex flex-wrap gap-2">
            {CHAT_BG_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => onChatBg?.({ type: 'color', value: p.value })}
                className="w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xs"
                style={{
                  borderColor: isPresetActive(p.value) ? '#07c160' : 'var(--td-component-stroke)',
                  backgroundColor: p.value || 'var(--td-bg-color-component)',
                  color: 'var(--td-text-color-secondary)',
                }}
                title={p.label}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => bgImgRef.current?.click()}
              className="w-12 h-12 rounded-lg border-2 flex items-center justify-center text-xs"
              style={{ borderColor: isImageActive ? '#07c160' : 'var(--td-component-stroke)', color: 'var(--td-text-color-secondary)' }}
              title="上传图片"
            >
              图片
            </button>
            <input ref={bgImgRef} type="file" accept="image/*" className="hidden" onChange={handleBgImage} />
            {isImageActive && (
              <Button size="small" variant="text" onClick={() => onChatBg?.({ type: 'color', value: '' })}>清除背景</Button>
            )}
          </div>
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

        <div className="border-t pt-4" style={{ borderColor: 'var(--td-component-stroke)' }}>
          <div className="text-sm font-medium mb-1" style={{ color: 'var(--td-text-color-primary)' }}>数据与备份</div>
          <div className="text-xs mb-3" style={{ color: 'var(--td-text-color-secondary)' }}>
            导出全部联系人、会话与消息为 JSON 文件（不含媒体文件本体），便于备份与迁移。
          </div>
          <Button variant="outline" size="small" onClick={handleExport}>导出聊天记录</Button>
        </div>
      </div>
    </Dialog>
  );
}
