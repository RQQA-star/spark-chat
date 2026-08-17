/**
 * 跨机远程协助 · 安全判定（纯函数，便于单测）
 * 被控端在执行控制端（B / 星火助手）下发的指令前，据此判定是否为危险操作，
 * 危险操作默认自动拒绝，避免 rm -rf / format / shutdown / 写系统目录等越权或破坏行为。
 */

export const DANGER_PATTERNS: RegExp[] = [
  /\brm\s+(-rf|-fr|--recursive|--force)\b/i,
  /\brmdir\s+\/[a-z]/i,
  /\bdel\s+\/[a-z]/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />+\s*\/dev\//i,
  /\bsudo\b/i,
  /\b:\s*\)\s*\{\s*:\s*\|\s*:/i, // fork bomb
];

export function isSystemPath(p: string): boolean {
  const u = (p || '').replace(/\\/g, '/').toLowerCase();
  return (
    /^(c:\/windows|windows|syswow64|system32|\/etc\/|\/usr\/|bootmgr)/.test(u) ||
    u.includes('/windows/') ||
    u.includes('pagefile')
  );
}

export interface ActionLike {
  action: string;
  params: Record<string, any>;
}

export function isDangerous(a: ActionLike): boolean {
  if (a.action === 'run_command') {
    const cmd = a.params?.command || '';
    if (DANGER_PATTERNS.some((re) => re.test(cmd))) return true;
  }
  if (a.action === 'write_file') {
    if (isSystemPath(a.params?.path || '')) return true;
  }
  return false;
}
