import { useState, useRef } from 'react';
import { Button } from 'tdesign-react';
import { Mic, MicOff, Send, Square, X, Check, Smile, Image as ImageIcon, File as FileIcon } from 'lucide-react';
import { Contact } from '../types';
import { useVoice, blobToBase64, blobExt } from '../hooks/useVoice';

interface ReplyInfo {
  id: string;
  senderName: string;
  preview: string;
}

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
}

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','🤔','😎','😭','😅','🙄','👍','👎','👏','🙏','💪','🎉','🔥','❤️','💔','✨','🌹','🌟','🍻','☕','🚀','💡','✅','❌'];

function fmtDur(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ChatInput({ onSendText, onSendVoice, onSendImage, isAgentThinking, onStop, placeholder, isGroup, members = [], meId = 'me', replyTo, onCancelReply, onSendFile }: ChatInputProps) {
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

  const filteredMembers = candidateMembers.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase()));

  const selectMention = (name: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? text.length;
    const anchor = mentionAnchor.current >= 0 ? mentionAnchor.current : caret;
    const before = text.slice(0, anchor);
    const after = text.slice(caret);
    const insert = '@' + name + ' ';
    const newText = before + insert + after;
    setText(newText);
    setShowMention(false);
    requestAnimationFrame(() => { el?.focus(); });
  };

  const collectMentions = (t: string): string[] => {
    if (!isGroup) return [];
    return candidateMembers.filter(m => t.includes('@' + m.name)).map(m => m.id);
  };

  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    const quote = replyTo ? { messageId: replyTo.id, senderName: replyTo.senderName, preview: replyTo.preview } : undefined;
    onSendText(t, collectMentions(t), quote);
    setText('');
    setShowMention(false);
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

  return (
    <div className="px-4 pb-4 pt-3" style={{ backgroundColor: 'var(--td-bg-color-page)', borderTop: '1px solid var(--td-component-stroke)' }}>
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
              onClick={() => setShowEmoji(v => !v)}
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
                {EMOJIS.map(em => (
                  <button key={em} onClick={() => insertEmoji(em)} className="text-xl leading-none p-1 rounded hover:bg-[var(--td-bg-color-component-hover)]">
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

          {/* 录音按钮（按住说话：按下开始 / 松开发送 / 上滑取消） */}
          <button
            onPointerDown={handlePressStart}
            onPointerMove={handlePressMove}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
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
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: m.avatarColor || '#0052d9' }}>
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
          支持文字与语音消息 · 与「星火助手」对话即调用 CodeBuddy Agent
        </div>
      </div>
    </div>
  );
}
