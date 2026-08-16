import { useState, useEffect, useCallback } from 'react';
import { Contact } from '../types';

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [me, setMe] = useState<{ id: string; name: string }>({ id: 'me', name: '我' });
  const [loading, setLoading] = useState(true);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts');
      const data = await res.json();
      setContacts(data.contacts || []);
      if (data.me) setMe(data.me);
    } catch (e) {
      console.error('获取联系人失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const getContact = useCallback((id: string) => {
    return contacts.find(c => c.id === id);
  }, [contacts]);

  const agentContacts = contacts.filter(c => c.isAgent);

  const addContact = useCallback(async (name: string, color?: string): Promise<Contact | null> => {
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), avatarColor: color }),
      });
      const data = await res.json();
      if (data.contact) {
        setContacts(prev => [...prev, data.contact]);
        return data.contact as Contact;
      }
      return null;
    } catch (e) { console.error('添加联系人失败', e); return null; }
  }, []);

  const deleteContact = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) setContacts(prev => prev.filter(c => c.id !== id));
      return !!data.success;
    } catch (e) { console.error('删除联系人失败', e); return false; }
  }, []);

  const updateContact = useCallback(async (
    id: string,
    updates: { name?: string; avatarText?: string; avatarColor?: string; agentConfig?: unknown; remark?: string; starred?: boolean },
  ): Promise<Contact | null> => {
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.contact) {
        setContacts(prev => prev.map(c => (c.id === id ? data.contact : c)));
        return data.contact as Contact;
      }
      return null;
    } catch (e) { console.error('更新联系人失败', e); return null; }
  }, []);

  return { contacts, me, loading, getContact, agentContacts, fetchContacts, addContact, deleteContact, updateContact };
}
