import type { CSSProperties, ReactNode } from 'react';

export interface PopupMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
  testId?: string;
}

interface PopupMenuProps {
  items: PopupMenuItem[];
  testId?: string;
  /** 定位类（如 fixed/absolute + 位置 + z-index），追加到卡片基础样式之后 */
  className?: string;
  style?: CSSProperties;
}

/**
 * 统一的长按 / 右键 / 下拉动作菜单（微信式卡片）：
 * - 卡片：圆角 + 阴影 + 主题背景/描边，自适应深/浅色
 * - 项：左对齐、图标+文字、hover 高亮；危险项文字标红
 * 定位与点击空白处关闭由调用方在外层控制（本组件只负责卡片内容）。
 */
export function PopupMenu({ items, testId, className = '', style }: PopupMenuProps) {
  return (
    <div
      data-testid={testId}
      className={`min-w-[150px] rounded-xl shadow-xl py-1 ${className}`}
      style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)', ...style }}
    >
      {items.map((it) => (
        <button
          key={it.key}
          data-testid={it.testId}
          onClick={it.onClick}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-[var(--td-bg-color-component-hover)]"
          style={{ color: it.danger ? '#e34d59' : 'var(--td-text-color-primary)' }}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}
