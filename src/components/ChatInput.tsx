import { useState, useRef, useEffect } from 'react';
import { Button } from 'tdesign-react';
import { Mic, MicOff, Send, Square, X, Check, Smile, Image as ImageIcon, File as FileIcon, Plus, MapPin, Film, Link2, UserPlus, SmilePlus } from 'lucide-react';
import { Contact } from '../types';
import { useVoice, blobToBase64, blobExt } from '../hooks/useVoice';

interface ReplyInfo {
  id: string;
  senderName: string;
  preview: string;
}

// 大表情（贴纸）候选集
const STICKERS = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎'];

interface ChatInputProps {
  onSendText: (text: string, mentions?: string[], quote?: { messageId: string; senderName: string; preview: string; msgType?: string }) => void;
  onSendVoice: (base64: string, ext: string, durationMs: number, transcript?: string) => void;
  onSendImage: (base64: string, ext: string) => void;
  isAgentThinking: boolean;
  onStop: () => void;
  placeholder?: string;
  isGroup?: boolean;
  members?: Contact[];
  meId?: string;
  replyTo?: ReplyInfo | null;
  onCancelReply?: () => void;
  onSendFile?: (base64: string, ext: string, name: string) => void;
  onSendSticker?: (emoji: string) => void;
  onSendLink?: (url: string) => void;
  onSendVideo?: (base64: string, ext: string) => void;
  onSendLocation?: (lat: number, lng: number, name?: string, address?: string) => void;
  onSendCard?: (contactId: string) => void;
  contacts?: Contact[];
  /** 撤回后「重新编辑」回填（text + nonce 触发） */
  reedit?: { text: string; nonce: number } | null;
  /** 当前会话的草稿文本（切换会话时回填输入框） */
  draft?: string;
  /** 输入框文本变化（含发送后清空）时回传，用于持久化草稿 */
  onDraftChange?: (text: string) => void;
}

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','🤔','😎','😭','😅','🙄','👍','👎','👏','🙏','💪','🎉','🔥','❤️','💔','✨','🌹','🌟','🍻','☕','🚀','💡','✅','❌'];

function fmtDur(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ChatInput({ onSendText, onSendVoice, onSendImage, isAgentThinking, onStop, placeholder, isGroup, members = [], meId = 'me', replyTo, onCancelReply, onSendFile, onSendSticker, onSendLink, onSendVideo, onSendLocation, onSendCard, contacts = [], reedit, draft, onDraftChange }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const anyFileRef = useRef<HTMLInputElement>(null);
  const { recording, durationMs, levels, startRecording, stopRecording, cancelRecording } = useVoice();
  const uploadingRef = useRef(false);
  const pressStartedRef = useRef(false);
  const cancelModeRef = useRef(false);
  const pressStartYRef = useRef<number | null>(null);
  const pressStartRef = useRef(0);
  const [cancelMode, setCancelMode] = useState(false);

  // @ 成员提及
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionAnchor = useRef(-1);

  // 表情面板
  const [showEmoji, setShowEmoji] = useState(false);
  const insertEmoji = (e: string) => {
    setText(prev => prev + e);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // 大表情（贴纸）面板
  const [showSticker, setShowSticker] = useState(false);

  // 撤回后「重新编辑」：把原文本回填到输入框（reedit.nonce 变化即触发一次）
  useEffect(() => {
    if (reedit?.text != null) {
      setText(reedit.text);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [reedit]);

  // 草稿回填：切换会话时 draft 变化即把对应会话的未发送文本装回输入框
  useEffect(() => {
    if (draft != null && draft !== text) setText(draft);
    // 故意仅依赖 draft：text 由本 effect 写入，且 draft 与 text 在同一渲染帧内保持一致
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const insertSticker = (e: string) => {
    onSendSticker?.(e);
    setShowSticker(false);
  };

  // 点击输入区外部 或 按 ESC 时关闭所有浮层（表情 / 大表情 / + 菜单 / 名片选择器）
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
        setShowSticker(false);
        setShowPlus(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEmoji(false);
        setShowSticker(false);
        setShowPlus(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // 「+」扩展菜单（名片 / 位置 / 视频 / 链接）
  const [showPlus, setShowPlus] = useState(false);
  const [cardPicker, setCardPicker] = useState(false);
  const videoRef = useRef<HTMLInputElement>(null);

  const handleVideoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { alert('视频过大（上限 200MB）'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      const ext = file.name.split('.').pop() || 'mp4';
      onSendVideo?.(base64, ext);
    };
    reader.readAsDataURL(file);
  };

  const sendLocationNow = () => {
    setShowPlus(false);
    const fallback = () => onSendLocation?.(0, 0, '我的位置', '（定位不可用，示例坐标）');
    if (!navigator.geolocation) { fallback(); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => onSendLocation?.(pos.coords.latitude, pos.coords.longitude, '我的位置'),
      () => fallback(),
      { enableHighAccuracy: false, timeout: 5000 },
    );
  };

  const sendLinkNow = () => {
    setShowPlus(false);
    const url = window.prompt('输入链接地址（http(s):// 开头）');
    if (url && /^https?:\/\//i.test(url.trim())) onSendLink?.(url.trim());
  };

  const pickCard = (id: string) => {
    setCardPicker(false);
    setShowPlus(false);
    onSendCard?.(id);
  };

  // 选择图片 -> base64 -> 上传
  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { alert('图片过大（上限 8MB）'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      const ext = file.name.split('.').pop() || 'png';
      onSendImage(base64, ext);
    };
    reader.readAsDataURL(file);
  };

  // 选择任意文件 -> base64 -> 上传
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('文件过大（上限 50MB）'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || '';
      const ext = file.name.split('.').pop() || 'bin';
      onSendFile?.(base64, ext, file.name);
    };
    reader.readAsDataURL(file);
  };

  const candidateMembers = isGroup ? members.filter(m => m.id !== meId) : [];

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const caret = e.target.selectionStart ?? val.length;
    setText(val);
    onDraftChange?.(val);
    // 输入框随内容自动增高（上限 128px，约 max-h-32），超过则内部滚动
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
    const before = val.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (match) {
      mentionAnchor.current = caret - match[2].length - 1;
      setMentionQuery(match[2]);
      setShowMention(true);
    } else {
      setShowMention(false);
    }
  };

  const mentionAllOption: Contact = { id: 'all', name: '所有人', avatarText: '@', avatarColor: '#e34d59' } as Contact;
  const mentionBaseOptions = isGroup ? [mentionAllOption, ...candidateMembers] : candidateMembers;
  const filteredMembers = mentionBaseOptions.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const selectMention = (name: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const anchor = mentionAnchor.current >= 0 ? mentionAnchor.current : caret;
    const before = text.slice(0, anchor);
    const after = text.slice(caret);
    const insert = '@' + name + ' ';
    const newText = before + insert + after;
    setText(newText);
    onDraftChange?.(newText);
    setShowMention(false);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 128) + 'px'; }
    });
  };

  const collectMentions = (t: string): string[] => {
    if (!isGroup) return [];
    const ids = candidateMembers.filter(m => t.includes('@' + m.name)).map(m => m.id);
    if (/@所有人|@all/i.test(t)) ids.push('all'); // 群 @ 所有人
    return ids;
  };

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    const quote = replyTo ? { messageId: replyTo.id, senderName: replyTo.senderName, preview: replyTo.preview } : undefined;
    onSendText(t, collectMentions(t), quote);
    setText('');
    onDraftChange?.('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setShowMention(false);
    setShowEmoji(false);
    setShowSticker(false);
    setShowPlus(false);
    if (replyTo) onCancelReply?.();
  };

  // 微信式「按住说话」：按下开始、松开发送、上滑取消
  const handlePressStart = async (e: React.PointerEvent | React.TouchEvent) => {
    e.preventDefault();
    if (recording) return;
    pressStartedRef.current = true;
    pressStartRef.current = Date.now();
    pressStartYRef.current = 'clientY' in e ? e.clientY : null;
    cancelModeRef.current = false;
    setCancelMode(false);
    // 捕获指针：后续 move/up 全部归到本按钮，桌面端按住时鼠标移出按钮也不会误发
    const pe = e as React.PointerEvent;
    if (pe.currentTarget?.setPointerCapture) {
      try { pe.currentTarget.setPointerCapture(pe.pointerId); } catch { /* 忽略：部分环境不支持 */ }
    }
    await startRecording();
  };

  const handlePressMove = (e: React.PointerEvent) => {
    if (!recording) return;
    const y = e.clientY;
    if (pressStartYRef.current == null) pressStartYRef.current = y;
    const up = (pressStartYRef.current ?? y) - y;
    const next = up > 60;
    if (next !== cancelModeRef.current) {
      cancelModeRef.current = next;
      setCancelMode(next);
    }
  };

  const handlePressEnd = async () => {
    if (!recording) { pressStartedRef.current = false; return; }
    const elapsed = Date.now() - pressStartRef.current;
    const wasCancel = cancelModeRef.current || elapsed < 300; // 太短视为误触，取消
    cancelModeRef.current = false;
    setCancelMode(false);
    pressStartYRef.current = null;
    if (wasCancel) { cancelRecording(); return; }
    const result = await stopRecording();
    if (result && !uploadingRef.current) {
      uploadingRef.current = true;
      try {
        const b64 = await blobToBase64(result.blob);
        onSendVoice(b64, blobExt(result.blob), result.durationMs, result.transcript || undefined);
      } catch (e) { console.error('语音处理失败', e); }
      finally { uploadingRef.current = false; }
    }
  };

  // 微信式：录音达到 60s 上限自动停止并发送（与松手发送同一路径；取消模式则取消）
  useEffect(() => {
    if (recording && durationMs >= 60000) {
      void handlePressEnd();
    }
  }, [recording, durationMs, handlePressEnd]);

  return (
    <div ref={rootRef} className="px-4 pb-4 pt-3" style={{ backgroundColor: 'var(--td-bg-color-page)', borderTop: '1px solid var(--td-component-stroke)' }}>
      <div className="max-w-3xl mx-auto">
        {replyTo && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--td-bg-color-container)', borderLeft: '3px solid #07c160' }}>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>回复 {replyTo.senderName}</div>
              <div className="text-xs truncate" style={{ color: 'var(--td-text-color-placeholder)' }}>{replyTo.preview}</div>
            </div>
            <button onClick={onCancelReply} className="p-1 rounded hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-placeholder)' }} title="取消回复">
              <X size={14} />
            </button>
          </div>
        )}
        <div
          className="rounded-2xl px-3 py-2 flex items-center gap-2"
          style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
        >
          {/* 表情 / 图片 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => { setShowEmoji(v => !v); setShowSticker(false); setShowPlus(false); }}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
              title="表情"
            >
              <Smile size={18} />
            </button>
            {showEmoji && (
              <div
                className="absolute bottom-full left-0 mb-2 w-64 p-2 rounded-xl shadow-lg grid grid-cols-6 gap-1 z-20"
                style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
              >
                {EMOJIS.map((em, i) => (
                  <button key={`emoji-${i}-${em}`} onClick={() => insertEmoji(em)} className="text-xl leading-none p-1 rounded hover:bg-[var(--td-bg-color-component-hover)]">
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
            title="发送图片"
          >
            <ImageIcon size={18} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
          <button
            onClick={() => anyFileRef.current?.click()}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
            title="发送文件"
          >
            <FileIcon size={18} />
          </button>
          <input ref={anyFileRef} type="file" className="hidden" onChange={handleFilePick} />

          {/* 大表情（贴纸） */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => { setShowSticker(v => !v); setShowEmoji(false); setShowPlus(false); }}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
              title="大表情"
            >
              <SmilePlus size={18} />
            </button>
            {showSticker && (
              <div
                className="absolute bottom-full left-0 mb-2 w-64 p-2 rounded-xl shadow-lg grid grid-cols-7 gap-1 z-20 max-h-56 overflow-y-auto"
                style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
              >
                {STICKERS.map((em, i) => (
                  <button key={`sticker-${i}-${em}`} onClick={() => insertSticker(em)} className="text-2xl leading-none p-1 rounded hover:bg-[var(--td-bg-color-component-hover)]">
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 「+」扩展菜单：名片 / 位置 / 视频 / 链接 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => { setShowPlus(v => !v); setShowSticker(false); setShowEmoji(false); }}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
              title="更多"
            >
              <Plus size={18} />
            </button>
            {showPlus && (
              <div
                className="absolute bottom-full left-0 mb-2 w-44 rounded-xl shadow-lg p-1 z-20"
                style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
              >
                <button onClick={() => setCardPicker(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-primary)' }}>
                  <UserPlus size={16} /> 名片
                </button>
                <button onClick={sendLocationNow} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-primary)' }}>
                  <MapPin size={16} /> 位置
                </button>
                <button onClick={() => { setShowPlus(false); videoRef.current?.click(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-primary)' }}>
                  <Film size={16} /> 视频
                </button>
                <button onClick={sendLinkNow} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--td-bg-color-component-hover)]" style={{ color: 'var(--td-text-color-primary)' }}>
                  <Link2 size={16} /> 链接
                </button>
                {cardPicker && (
                  <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border p-1" style={{ borderColor: 'var(--td-component-stroke)' }}>
                    {contacts.filter(c => c.id !== meId).map(c => (
                      <button key={c.id} onClick={() => pickCard(c.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--td-bg-color-component-hover)]">
                        <div className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: c.avatarColor || '#0052d9' }}>
                          {c.avatarText || c.name.slice(0, 1)}
                        </div>
                        <span className="text-sm truncate" style={{ color: 'var(--td-text-color-primary)' }}>{c.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={handleVideoPick} />

          {/* 录音按钮（按住说话：按下开始 / 松开发送 / 上滑取消） */}
          <button
            onPointerDown={handlePressStart}
            onPointerMove={handlePressMove}
            onPointerUp={handlePressEnd}
            onClick={e => e.preventDefault()}
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors select-none touch-none"
            style={{
              backgroundColor: recording ? (cancelMode ? '#e34d59' : '#07c160') : 'var(--td-bg-color-component-hover)',
              color: recording ? '#fff' : 'var(--td-text-color-secondary)',
            }}
            title={recording ? (cancelMode ? '松开取消' : '松开发送') : '按住说话'}
          >
            {recording ? <Mic size={18} /> : <Mic size={18} />}
          </button>

          {/* 录音中状态 */}
          {recording ? (
            <div className="flex-1 flex items-center gap-2 py-1.5" style={{ color: cancelMode ? '#e34d59' : 'var(--td-text-color-primary)' }}>
              <div className="flex items-end gap-[2px] h-5">
                {(levels.length ? levels : Array.from({ length: 14 }, () => 0.15)).map((v, i) => (
                  <span key={i} className="w-[3px] rounded-full transition-all" style={{ height: `${Math.max(3, Math.round(v * 20))}px`, backgroundColor: 'currentColor', opacity: 0.85 }} />
                ))}
              </div>
              <span className="text-sm font-medium tabular-nums">{fmtDur(durationMs)}</span>
              <span className="text-xs" style={{ color: cancelMode ? '#e34d59' : 'var(--td-text-color-placeholder)' }}>{cancelMode ? '· 松开取消' : '· 松开发送'}</span>
            </div>
          ) : (
            <div className="relative flex-1">
              {showMention && isGroup && filteredMembers.length > 0 && (
                <div
                  className="absolute bottom-full left-0 mb-2 w-56 max-h-52 overflow-y-auto rounded-xl shadow-lg p-1 z-20"
                  style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
                >
                  <div className="px-2 py-1 text-[11px]" style={{ color: 'var(--td-text-color-placeholder)' }}>选择要 @ 的成员</div>
                  {filteredMembers.map(m => (
                    <div
                      key={m.id}
                      onClick={() => selectMention(m.name)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[var(--td-bg-color-component-hover)]"
                    >
                      <div className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: m.avatarColor || '#0052d9' }}>
                        {m.avatarText || m.name.slice(0, 1)}
                      </div>
                      <span className="text-sm" style={{ color: 'var(--td-text-color-primary)' }}>{m.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleChange}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                rows={1}
                placeholder={placeholder || '输入消息，Enter 发送，Shift+Enter 换行'}
                className="flex-1 resize-none bg-transparent outline-none py-1.5 text-[15px] max-h-32"
                style={{ color: 'var(--td-text-color-primary)' }}
              />
            </div>
          )}

          {/* 发送 / 停止 */}
          {recording ? (
            <button
              onClick={cancelRecording}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--td-bg-color-component-hover)', color: 'var(--td-text-color-secondary)' }}
              title="取消录音"
            >
              <X size={18} />
            </button>
          ) : isAgentThinking ? (
            <Button size="small" icon={<Square size={14} />} onClick={onStop} theme="warning" variant="outline" style={{ height: 40 }}>
              停止
            </Button>
          ) : (
            <Button
              size="small"
              icon={<Send size={14} />}
              onClick={handleSend}
              disabled={!text.trim()}
              style={{ height: 40, backgroundColor: '#07c160', borderColor: '#07c160', color: '#fff' }}
            >
              发送
            </Button>
          )}
        </div>
        <div className="text-[11px] mt-1.5 px-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
          支持文字、语音、图片、视频、位置、名片与大表情 · 与「星火助手」对话即调用 CodeBuddy Agent
        </div>
      </div>
    </div>
  );
}
