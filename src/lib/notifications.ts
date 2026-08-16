// 桌面通知单例：集中管理浏览器通知权限与「@ 我」提醒
// 用单例而非 hook，避免 useMessages / App 之间的层层透传。

let supported: boolean =
  typeof window !== 'undefined' && 'Notification' in window;

let permissionState: NotificationPermission = supported
  ? Notification.permission
  : ('unsupported' as NotificationPermission);

let enabled = permissionState === 'granted';

// 当前正在查看的会话（真实 App 不会打扰正在看的会话，这里主要用于点击通知后跳转）
let activeConversationId: string | null = null;
// 点击通知时切换到对应会话的回调（由 App 注册）
let activateHandler: ((convId: string) => void) | null = null;

export type NotifState = 'default' | 'granted' | 'denied' | 'unsupported';

export function getNotificationState(): NotifState {
  if (!supported) return 'unsupported';
  if (permissionState === 'denied') return 'denied';
  return enabled ? 'granted' : 'default';
}

export async function requestNotificationPermission(): Promise<NotifState> {
  if (!supported) return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    permissionState = p;
    enabled = p === 'granted';
    return p as NotifState;
  } catch {
    return permissionState as NotifState;
  }
}

export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

export function setActivateHandler(fn: ((convId: string) => void) | null): void {
  activateHandler = fn;
}

/** 收到一条 @ 我的消息时，弹出系统通知 */
export function notifyAtMention(
  senderName: string,
  preview: string,
  conversationId: string,
): void {
  if (!enabled || !supported) return;
  try {
    const body =
      preview && preview.length > 100 ? preview.slice(0, 100) + '…' : preview || '';
    const n = new Notification(`[有人 @ 我] ${senderName}`, {
      body,
      // 同一会话的多次 @ 合并为一条，避免刷屏
      tag: `spark-mention-${conversationId}`,
      requireInteraction: false,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      activateHandler?.(conversationId);
      n.close();
    };
  } catch (e) {
    console.error('桌面通知发送失败', e);
  }
}
