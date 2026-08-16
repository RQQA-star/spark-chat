// ============= 本地安全校验工具（G3 + S3） =============
// 星火聊天是一个**仅本机运行**的服务（server 绑定 127.0.0.1）。
// 本模块集中实现两层防御，供 HTTP 中间件与 WebSocket 升级（verifyClient）共用，统一口径：
//   1) 来源校验（S3）：仅允许本机浏览器来源（127.0.0.1 / localhost / ::1），挡住恶意网页借助用户浏览器发起的跨站请求。
//   2) 访问令牌（G3）：若配置了 SPARK_ACCESS_TOKEN，则所有请求必须携带正确令牌；未配置则不强制（本地开发免鉴权）。
// 由于 server 仅监听 127.0.0.1，远程主机本就无法建立 TCP 连接，Origin 校验主要防「同机浏览器被恶意站点利用」，
// 令牌校验则作为纵深防御，防止本机其它未授权进程随意调用 API。

const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
  '0:0:0:0:0:0:0:1',
]);

/**
 * 判断请求来源是否允许连接本机服务。
 * - 无 Origin（非浏览器客户端，如 curl / supertest / 移动端壳）一律放行。
 * - 仅允许 http/https 协议下、主机为回环地址的来源。
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  return LOOPBACK_HOSTS.has(host);
}

/** 读取当前配置的访问令牌；未配置则为空串（空串表示不强制鉴权）。 */
export function getAccessToken(): string {
  return process.env.SPARK_ACCESS_TOKEN?.trim() || '';
}

/**
 * 校验请求携带的访问令牌是否正确。
 * - 未配置令牌：一律通过（本地开发免鉴权，靠 127.0.0.1 绑定隔离）。
 * - 已配置令牌：必须与 Bearer / query 令牌严格一致，否则拒绝。
 */
export function isTokenValid(providedToken: string | undefined | null): boolean {
  const expected = getAccessToken();
  if (!expected) return true;
  return !!providedToken && providedToken === expected;
}

/** 从 Authorization 头解析 Bearer 令牌（无/格式错误返回 undefined）。 */
export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m?.[1]?.trim() || undefined;
}
