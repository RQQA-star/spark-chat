// 前端访问令牌管理：与服务端 SPARK_ACCESS_TOKEN 鉴权配套。
// 设计目标：未配置令牌时完全无感（本机免鉴权体验不变）；配置了令牌时，
// 前端在启动探测到「需要令牌」后引导用户输入一次并持久化到 localStorage，
// 之后所有同源 /api 请求自动带 Authorization: Bearer，WebSocket 带 ?token=。

const TOKEN_KEY = 'spark_access_token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

// 在应用入口调用一次：覆写 window.fetch，自动给请求注入 Authorization 头。
// 这样无需改动散落在各组件 / hooks 的 20+ 处 fetch 调用点。仅浏览器环境执行。
export function installAuthFetch(): void {
  if (typeof window === 'undefined') return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getToken();
    if (token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
}

// 给 WebSocket URL 附加 token 查询参数（服务端 WS verifyClient 从 query 取令牌）。
export function buildWsUrl(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// 免鉴权探测：服务端是否要求访问令牌（GET /api/auth/config，该端点自身免鉴权）。
export async function fetchAuthConfig(): Promise<{ tokenRequired: boolean }> {
  try {
    const res = await fetch('/api/auth/config');
    if (!res.ok) return { tokenRequired: false };
    const data = (await res.json()) as { tokenRequired?: boolean };
    return { tokenRequired: !!data.tokenRequired };
  } catch {
    return { tokenRequired: false };
  }
}
