import { useEffect } from 'react';
import { X } from 'lucide-react';

interface LightboxProps {
  imagePath: string | null;
  onClose: () => void;
}

/**
 * 大图灯箱：点击聊天图片后在应用内全屏查看（深色模式感知），
 * 不再跳转新标签页。Esc / 点击遮罩关闭。
 */
export function Lightbox({ imagePath, onClose }: LightboxProps) {
  useEffect(() => {
    if (!imagePath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePath, onClose]);

  if (!imagePath) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff' }}
        onClick={onClose}
        title="关闭 (Esc)"
      >
        <X size={20} />
      </button>
      <img
        src={`/api/image/${imagePath}`}
        alt="预览大图"
        className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
