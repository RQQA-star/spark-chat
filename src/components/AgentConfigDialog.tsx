import { useState, useEffect, useCallback } from 'react';
import { Dialog, Input, Button } from 'tdesign-react';
import { Contact, AgentConfig, PermissionMode } from '../types';

interface AgentConfigDialogProps {
  visible: boolean;
  contact: Contact | null;
  onClose: () => void;
  onSave: (agentConfig: AgentConfig) => Promise<unknown> | void;
}

// 权限模式说明（与 server 端 permissionMode 取值一致）
const PERMISSION_MODES: { value: PermissionMode; title: string; desc: string; danger?: boolean }[] = [
  { value: 'default', title: '逐项询问', desc: '每次工具调用都弹出确认，最安全（默认）。' },
  { value: 'acceptEdits', title: '自动接受编辑', desc: '自动同意文件读写类编辑，仍会询问执行命令。' },
  { value: 'plan', title: '计划模式', desc: '先给出执行计划，确认后再动手。' },
  { value: 'bypassPermissions', title: '全部放行', desc: '不再询问直接执行，仅限可信的远程协助场景。', danger: true },
];

interface ModelOption { modelId: string; name: string; }
const FALLBACK_MODELS: ModelOption[] = [{ modelId: 'claude-sonnet-4', name: 'Claude Sonnet 4' }];

export function AgentConfigDialog({ visible, contact, onClose, onSave }: AgentConfigDialogProps) {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [model, setModel] = useState('');
  const [cwd, setCwd] = useState('');
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [defaultModel, setDefaultModel] = useState('');
  const [busy, setBusy] = useState(false);

  // 打开时：用联系人当前配置初始化表单，并拉取可用模型列表
  useEffect(() => {
    if (!visible || !contact) return;
    const cfg = contact.agentConfig;
    setSystemPrompt(cfg?.systemPrompt || '');
    setPermissionMode((cfg?.permissionMode as PermissionMode) || 'default');
    setModel(cfg?.model || '');
    setCwd(cfg?.cwd || '');
    setBusy(false);
    (async () => {
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        const list: ModelOption[] = Array.isArray(data.models) && data.models.length
          ? data.models.map((m: any) => ({ modelId: m.modelId, name: m.name || m.modelId }))
          : FALLBACK_MODELS;
        setModels(list);
        setDefaultModel(data.defaultModel || '');
        setModel(prev => prev || data.defaultModel || (list[0] && list[0].modelId) || '');
      } catch {
        setModels(FALLBACK_MODELS);
      }
    })();
  }, [visible, contact]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave({ systemPrompt: systemPrompt.trim(), permissionMode, model: model || defaultModel, cwd: cwd.trim() || undefined });
      onClose();
    } finally {
      setBusy(false);
    }
  }, [busy, onSave, systemPrompt, permissionMode, model, defaultModel, cwd, onClose]);

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      header={`配置「${contact?.name || '助手'}」`}
      onConfirm={handleSave}
      confirmBtn={{ content: '保存', disabled: busy }}
      cancelBtn="取消"
      width={460}
    >
      <div className="space-y-5 py-1">
        {/* 权限模式 */}
        <div>
          <div className="text-sm mb-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>权限模式</div>
          <div className="grid grid-cols-2 gap-2">
            {PERMISSION_MODES.map(m => {
              const active = permissionMode === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => setPermissionMode(m.value)}
                  className="text-left rounded-lg p-2.5 transition-colors"
                  style={{
                    border: `1px solid ${active ? (m.danger ? '#e34d59' : '#0052d9') : 'var(--td-component-stroke)'}`,
                    backgroundColor: active ? (m.danger ? 'rgba(227,77,89,0.08)' : 'rgba(0,82,217,0.08)') : 'var(--td-bg-color-container)',
                  }}
                >
                  <div className="text-sm font-medium" style={{ color: m.danger ? '#e34d59' : 'var(--td-text-color-primary)' }}>{m.title}</div>
                  <div className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--td-text-color-placeholder)' }}>{m.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 模型 */}
        <div>
          <div className="text-sm mb-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>模型</div>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: 'var(--td-bg-color-container)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
          >
            {models.map(m => (
              <option key={m.modelId} value={m.modelId}>{m.name}</option>
            ))}
            {model && !models.some(m => m.modelId === model) && (
              <option value={model}>{model}（当前配置）</option>
            )}
          </select>
        </div>

        {/* 工作目录 */}
        <div>
          <div className="text-sm mb-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>工作目录（可选）</div>
          <Input value={cwd} onChange={(e: string) => setCwd(e)} placeholder="如 D:/projects/myapp，留空则用应用目录" />
        </div>

        {/* 系统提示词 */}
        <div>
          <div className="text-sm mb-2 font-medium" style={{ color: 'var(--td-text-color-primary)' }}>系统提示词（可选）</div>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={4}
            placeholder="给助手设定角色与行为准则，留空则用默认提示词。"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y leading-relaxed"
            style={{ backgroundColor: 'var(--td-bg-color-container)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
          />
        </div>
      </div>
    </Dialog>
  );
}
