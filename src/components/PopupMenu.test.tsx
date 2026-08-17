import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PopupMenu, type PopupMenuItem } from './PopupMenu';

const items: PopupMenuItem[] = [
  { key: 'a', label: '回复', onClick: vi.fn() },
  { key: 'b', label: '删除', danger: true, onClick: vi.fn() },
];

describe('PopupMenu —— 统一动作菜单', () => {
  it('渲染所有菜单项并带容器 testid', () => {
    render(<PopupMenu items={items} testId="pm" />);
    expect(screen.getByTestId('pm')).toBeInTheDocument();
    expect(screen.getByText('回复')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('点击项触发对应回调', () => {
    render(<PopupMenu items={items} />);
    fireEvent.click(screen.getByText('回复'));
    expect(items[0].onClick).toHaveBeenCalledTimes(1);
  });

  it('危险项文字为红色（#e34d59 → rgb(227,77,89)）', () => {
    render(<PopupMenu items={items} />);
    expect(screen.getByText('删除').style.color).toBe('rgb(227, 77, 89)');
  });

  it('每项带 data-testid 钩子', () => {
    const withTestId: PopupMenuItem[] = [{ key: 'x', label: '撤回', testId: 'mi-recall', onClick: vi.fn() }];
    render(<PopupMenu items={withTestId} />);
    expect(screen.getByTestId('mi-recall')).toBeInTheDocument();
  });
});
