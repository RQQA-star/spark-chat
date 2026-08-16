import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditContactDialog } from './EditContactDialog';
import type { Contact } from '../types';

const contact = {
  id: 'u_123',
  name: '张三',
  avatarText: '张',
  avatarColor: '#0052d9',
  isAgent: false,
  status: 'online',
  agentConfig: null,
} as unknown as Contact;

describe('EditContactDialog —— 编辑联系人', () => {
  it('打开时回填联系人字段（名称 / 头像文字）', async () => {
    render(<EditContactDialog visible contact={contact} onClose={() => {}} onSave={() => {}} />);
    expect(await screen.findByDisplayValue('张三')).toBeTruthy();
    expect(screen.getByDisplayValue('张')).toBeTruthy();
  });

  it('修改名称后确认，调用 onSave 传入正确更新（保留原头像文字与颜色）', () => {
    const onSave = vi.fn();
    render(<EditContactDialog visible contact={contact} onClose={() => {}} onSave={onSave} />);
    const nameInput = screen.getByDisplayValue('张三') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '李四' } });
    fireEvent.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const updates = onSave.mock.calls[0][0];
    expect(updates.name).toBe('李四');
    expect(updates.avatarText).toBe('张');
    expect(updates.avatarColor).toBe('#0052d9');
  });

  it('头像文字清空时回退为名称首字', () => {
    const onSave = vi.fn();
    render(<EditContactDialog visible contact={contact} onClose={() => {}} onSave={onSave} />);
    const avatarInput = screen.getByDisplayValue('张') as HTMLInputElement;
    fireEvent.change(avatarInput, { target: { value: '  ' } });
    fireEvent.change(screen.getByDisplayValue('张三') as HTMLInputElement, { target: { value: '王五' } });
    fireEvent.click(screen.getByText('保存'));
    expect(onSave.mock.calls[0][0].avatarText).toBe('王');
  });
});
