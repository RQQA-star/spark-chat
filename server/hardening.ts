import type { Request, Response, NextFunction } from 'express';

// 轻量安全加固中间件（零依赖，规避本机杀软对 npm 的锁定；等价于 helmet 默认集的子集）。
// 说明：本项目多为本机/局域网单用户使用，故 CSP 适度宽松——允许同源脚本/样式
// （TDesign 使用内联 style）、data/blob 图片、同源及 ws/wss 连接；不引入第三方 CDN。

// 安全响应头
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // 默认关闭可能泄露本机信息的浏览器特性权限
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), clipboard-read=(), clipboard-write=(self)');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
  next();
}

// 内存固定窗口限流（按客户端 IP）。默认 60s 窗口 200 次，足够宽松，仅挡暴力/误用。
// 适用本机/小规模部署；大规模场景应换 Redis 等共享存储。
interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 200;

export function rateLimit(windowMs: number = RATE_WINDOW_MS, max: number = RATE_MAX) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 存活探针永不限流（容器健康检查高频调用）
    if (req.path === '/health') return next();

    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const b = buckets.get(ip);

    if (!b || now > b.resetAt) {
      // 重置窗口；顺手清理过期桶，避免内存无限增长
      if (buckets.size > 512) {
        for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
      }
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    b.count++;
    if (b.count > max) {
      res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      return;
    }
    next();
  };
}
