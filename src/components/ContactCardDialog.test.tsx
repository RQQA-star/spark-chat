import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContactCardDialog } from './ContactCardDialog';
import type { Contact } from '../types';

const contact = {
  id: 'u_123',
  name: '张三',
  avatarText: '张',
  avatarColor: '#0052d9',
  isAgent: false,
  status: 'online',
  remark: '老朋友',
  starred: false,
  agentConfig: null,
} as unknown as Contact;

describe('ContactCardDialog —— 个人名片页', () => {
  it('展示联系人名称与备注', async () => {
    render(
      <ContactCardDialog visible contact={contact} meId="me" onClose={() => {}} onSaveRemark={() => {}} onToggleStar={() => {}} onMessage={() => {}} />
    );
    expect(await screen.findByText('张三')).toBeTruthy();
    expect(screen.getByText('备注：老朋友')).toBeTruthy();
  });

  it('点击「星标」调用 onToggleStar(id, true)', async () => {
    const onToggleStar = vi.fn();
    render(
      <ContactCardDialog visible contact={contact} meId="me" onClose={() => {}} onSaveRemark={() => {}} onToggleStar={onToggleStar} onMessage={() => {}} />
    );
    const btn = await screen.findByText('星标');
    fireEvent.click(btn);
    expect(onToggleStar).toHaveBeenCalledWith('u_123', true);
  });

  it('点击「发消息」调用 onMessage 并关闭', async () => {
    const onMessage = vi.fn();
    const onClose = vi.fn();
    render(
      <ContactCardDialog visible contact={contact} meId="me" onClose={onClose} onSaveRemark={() => {}} onToggleStar={() => {}} onMessage={onMessage} />
    );
    const btn = await screen.findByText('发消息');
    fireEvent.click(btn);
    expect(onMessage).toHaveBeenCalledWith('u_123');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
