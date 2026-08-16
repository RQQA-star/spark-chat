import { useState } from 'react';
import { Button } from 'tdesign-react';
import {
  Terminal,
  File,
  FolderOpen,
  Search,
  Code,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  MessageSquareWarning,
} from 'lucide-react';
import { PermissionRequest } from '../types';

interface InlinePermissionCardProps {
  request: PermissionRequest;
  onAllow: () => void;
  onDeny: (message?: string) => void;
}

// 工具名称到图标和颜色的映射
const TOOL_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  'Bash': { icon: <Terminal />, color: '#e34d59', label: '执行命令' },
  'Write': { icon: <Pencil />, color: '#0052d9', label: '写入文件' },
  'Edit': { icon: <Pencil />, color: '#0052d9', label: '编辑文件' },
  'Read': { icon: <File />, color: '#2ba471', label: '读取文件' },
  'ReadFile': { icon: <File />, color: '#2ba471', label: '读取文件' },
  'ListDir': { icon: <FolderOpen />, color: '#ed7b2f', label: '列出目录' },
  'Search': { icon: <Search />, color: '#8a6be5', label: '搜索' },
  'Grep': { icon: <Search />, color: '#8a6be5', label: '文本搜索' },
  'Delete': { icon: <Trash2 />, color: '#e34d59', label: '删除文件' },
  'DeleteFile': { icon: <Trash2 />, color: '#e34d59', label: '删除文件' },
};

// 获取工具配置
const getToolConfig = (toolName: string) => {
  return TOOL_CONFIG[toolName] || {
    icon: <Code />,
    color: '#666666',
    label: toolName,
  };
};

// 获取文件路径或主要信息
const getMainInfo = (toolName: string, input: Record<string, unknown>): string => {
  if (toolName === 'Bash' && input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  if (input.filePath) {
    return String(input.filePath);
  }
  if (input.path) {
    return String(input.path);
  }
  if (input.target_file) {
    return String(input.target_file);
  }
  // 返回第一个有意义的参数值
  for (const [, value] of Object.entries(input)) {
    if (value && typeof value === 'string') {
      return value.length > 60 ? value.slice(0, 60) + '...' : value;
    }
  }
  return '';
};

export function InlinePermissionCard({ request, onAllow, onDeny }: InlinePermissionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [reason, setReason] = useState('');

  const toolConfig = getToolConfig(request.toolName);
  const mainInfo = getMainInfo(request.toolName, request.input);
  const isDangerous = request.toolName === 'Bash' || request.toolName === 'Delete' || request.toolName === 'DeleteFile';

  const fullInput = JSON.stringify(request.input, null, 2);

  return (
    <div
      className="animate-fade-in rounded-xl p-3 my-1"
      style={{
        border: `1px solid ${isDangerous ? 'rgba(227,77,89,0.4)' : 'var(--td-component-stroke)'}`,
        backgroundColor: isDangerous ? 'rgba(227,77,89,0.06)' : 'var(--td-bg-color-container)',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* 工具图标和标签 */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ backgroundColor: `${toolConfig.color}15`, color: toolConfig.color }}
        >
          <span className="flex items-center text-base">{toolConfig.icon}</span>
          <span className="text-sm font-medium">{toolConfig.label}</span>
        </div>

        {/* 文件路径/命令 */}
        {mainInfo && (
          <code
            className="text-sm px-2.5 py-1 rounded-md font-mono truncate max-w-[360px]"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' }}
            title={mainInfo}
          >
            {mainInfo}
          </code>
        )}

        {/* 危险操作警告标记 */}
        {isDangerous && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(227, 77, 89, 0.1)', color: '#e34d59' }}>
            ⚠️ 危险操作
          </span>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            size="small"
            variant="text"
            onClick={() => setExpanded(v => !v)}
            style={{ color: 'var(--td-text-color-placeholder)' }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} 详情
          </Button>
          <Button size="small" theme="danger" variant="text" onClick={() => onDeny()} style={{ color: '#e34d59', fontWeight: 500 }}>
            拒绝
          </Button>
          <Button size="small" theme="success" variant="base" onClick={onAllow} style={{ backgroundColor: '#2ba471', borderColor: '#2ba471', color: 'white', fontWeight: 500 }}>
            允许
          </Button>
        </div>
      </div>

      {/* 完整工具参数 */}
      {expanded && (
        <pre
          className="mt-2 text-xs p-2.5 rounded-lg overflow-auto max-h-48 font-mono whitespace-pre-wrap"
          style={{ backgroundColor: 'var(--td-bg-color-page)', color: 'var(--td-text-color-secondary)' }}
        >{fullInput}</pre>
      )}

      {/* 拒绝并留言 */}
      {reasoning ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onDeny(reason.trim() || undefined); }}
            placeholder="拒绝原因（可选）"
            className="flex-1 px-2.5 py-1.5 text-sm rounded-lg outline-none"
            style={{ backgroundColor: 'var(--td-bg-color-page)', color: 'var(--td-text-color-primary)', border: '1px solid var(--td-component-stroke)' }}
          />
          <Button size="small" theme="danger" variant="base" onClick={() => onDeny(reason.trim() || undefined)} style={{ backgroundColor: '#e34d59', borderColor: '#e34d59', color: 'white' }}>
            确认拒绝
          </Button>
          <Button size="small" variant="text" onClick={() => { setReasoning(false); setReason(''); }} style={{ color: 'var(--td-text-color-placeholder)' }}>
            取消
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setReasoning(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs"
          style={{ color: 'var(--td-text-color-placeholder)' }}
        >
          <MessageSquareWarning size={12} /> 拒绝并留言
        </button>
      )}
    </div>
  );
}
