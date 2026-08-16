// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { isAllowedOrigin, isTokenValid, getAccessToken, extractBearerToken } from './security';

describe('isAllowedOrigin (S3)', () => {
  it('无 Origin（非浏览器客户端）→ 放行', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin('')).toBe(true);
  });

  it('本机来源 127.0.0.1 / localhost / ::1（任意端口、http 或 https）→ 放行', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedOrigin('https://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:3000')).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1:17890')).toBe(true);
  });

  it('跨站 / 内网 / 非法来源 → 拒绝', () => {
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
    expect(isAllowedOrigin('http://192.168.1.10:3000')).toBe(false);
    expect(isAllowedOrigin('http://example.com')).toBe(false);
    expect(isAllowedOrigin('file:///Users/me/app/index.html')).toBe(false);
    expect(isAllowedOrigin('not-a-url')).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('解析标准 Bearer 头', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('bearer  xyz ')).toBe('xyz');
  });
  it('无头 / 非 Bearer → undefined', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('Basic abc')).toBeUndefined();
    expect(extractBearerToken('abc123')).toBeUndefined();
  });
});

describe('isTokenValid (G3)', () => {
  afterEach(() => { delete process.env.SPARK_ACCESS_TOKEN; });

  it('未配置令牌 → 任意/无令牌均通过（本地开发免鉴权）', () => {
    delete process.env.SPARK_ACCESS_TOKEN;
    expect(getAccessToken()).toBe('');
    expect(isTokenValid(undefined)).toBe(true);
    expect(isTokenValid('whatever')).toBe(true);
    expect(isTokenValid('')).toBe(true);
  });

  it('已配置令牌 → 必须严格匹配', () => {
    process.env.SPARK_ACCESS_TOKEN = 's3cret';
    expect(getAccessToken()).toBe('s3cret');
    expect(isTokenValid('s3cret')).toBe(true);
    expect(isTokenValid('s3cret ')).toBe(false); // 末尾空格不应被接受
    expect(isTokenValid('wrong')).toBe(false);
    expect(isTokenValid(undefined)).toBe(false);
  });

  it('已配置空白令牌 → 视为未配置', () => {
    process.env.SPARK_ACCESS_TOKEN = '   ';
    expect(getAccessToken()).toBe('');
    expect(isTokenValid(undefined)).toBe(true);
  });
});
