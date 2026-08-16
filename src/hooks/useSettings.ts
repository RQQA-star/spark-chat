import { useState, useEffect } from 'react';

const FONT_KEY = 'spark_font_scale';
const BG_KEY = 'spark_chat_bg';

export interface ChatBackground {
  /** color: 纯色（CSS 值，可空串表示用默认）；image: data URL 背景图 */
  type: 'color' | 'image';
  value: string;
}

export const CHAT_BG_PRESETS: { label: string; value: string }[] = [
  { label: '默认', value: '' },
  { label: '青瓷', value: '#e6f4f1' },
  { label: '暖灰', value: '#f2ede4' },
  { label: '淡紫', value: '#efeaf6' },
  { label: '天蓝', value: '#e7f0fb' },
];

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, val: string): void {
  try { localStorage.setItem(key, val); } catch { /* 配额超限等，忽略 */ }
}

export function useSettings() {
  const [fontScale, setFontScale] = useState<number>(() => {
    const v = Number(safeGet(FONT_KEY));
    return v >= 0.8 && v <= 1.4 ? v : 1;
  });
  const [chatBg, setChatBg] = useState<ChatBackground>(() => {
    try {
      const raw = safeGet(BG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatBackground;
        if (parsed && (parsed.type === 'color' || parsed.type === 'image')) return parsed;
      }
    } catch { /* 忽略损坏数据 */ }
    return { type: 'color', value: '' };
  });

  // 字体缩放：注入到根元素的 CSS 变量，聊天主文本依此缩放
  useEffect(() => {
    document.documentElement.style.setProperty('--spark-font-scale', String(fontScale));
    safeSet(FONT_KEY, String(fontScale));
  }, [fontScale]);

  // 聊天背景：注入到根元素的 CSS 变量（图片为 data URL，否则为颜色值）
  useEffect(() => {
    const v = chatBg && chatBg.value
      ? (chatBg.type === 'image' ? `url("${chatBg.value}") center / cover no-repeat fixed` : chatBg.value)
      : '';
    document.documentElement.style.setProperty('--spark-chat-bg', v);
    safeSet(BG_KEY, JSON.stringify(chatBg));
  }, [chatBg]);

  return { fontScale, setFontScale, chatBg, setChatBg };
}
