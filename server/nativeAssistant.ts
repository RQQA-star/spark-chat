/**
 * 原生键鼠注入助手管理（仅本机）
 * ----------------------------------------------------------
 * 仅允许启动本项目自带的 native-assistant/assist-helper.js（被控端原生进程，
 * 负责把 WebRTC 转发的控制事件还原为真实 OS 鼠标 / 键盘输入）。
 *
 * 安全约束：
 * - 启动目标是硬编码的项目内脚本路径，且启动时再次校验，绝不允许执行任意命令；
 * - 不拼接任何用户输入进入 spawn，避免命令注入；
 * - 测试环境下不真正启动进程（避免占用 17890 端口 / 拉起子进程）。
 */
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NATIVE_DIR = path.resolve(__dirname, '..', 'native-assistant');
const SCRIPT = path.join(NATIVE_DIR, 'assist-helper.js');
const HELPER_PORT = 17890;

function assertSafeScript(): void {
  const resolved = path.resolve(SCRIPT);
  // 防御：目标必须严格等于项目内 native-assistant/assist-helper.js
  if (resolved !== SCRIPT) throw new Error('非法助手脚本路径');
  if (!fs.existsSync(resolved)) throw new Error('助手脚本不存在');
}

let child: ChildProcess | null = null;
let lastError: string | null = null;

export interface NativeAssistantStatus {
  running: boolean;
  pid: number | null;
  error: string | null;
  port: number;
}

export function getStatus(): NativeAssistantStatus {
  const running = !!child && !child.killed && child.exitCode === null;
  return { running, pid: child && !child.killed ? (child.pid ?? null) : null, error: lastError, port: HELPER_PORT };
}

// 仅允许进程级单例：已运行时直接返回当前状态
export function start(): NativeAssistantStatus {
  if (child && !child.killed && child.exitCode === null) return getStatus();
  lastError = null;

  // 测试环境：不真正拉起子进程（避免占用端口 / 拖慢测试）
  if (process.env.NODE_ENV === 'test') {
    lastError = '测试环境不启动原生助手';
    return { running: false, pid: null, error: lastError, port: HELPER_PORT };
  }

  try {
    assertSafeScript();
    // 原生依赖（@nut-tree-fork/nut-js 含原生模块）需先 npm install
    const depReady = fs.existsSync(path.join(NATIVE_DIR, 'node_modules', '@nut-tree-fork', 'nut-js'));
    if (!depReady) {
      lastError = '原生依赖未安装：请先在 native-assistant 目录执行 npm install';
      return { running: false, pid: null, error: lastError, port: HELPER_PORT };
    }

    const proc = spawn(process.execPath, [SCRIPT], {
      cwd: NATIVE_DIR,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;

    proc.stdout?.on('data', () => { /* 助手日志（stdout）暂不持久化 */ });
    proc.stderr?.on('data', (d) => {
      const msg = (d.toString() || '').trim();
      if (msg) lastError = msg.slice(0, 500);
    });
    proc.on('exit', (code) => {
      if (child === proc) {
        child = null;
        if (code && code !== 0 && !lastError) lastError = `助手进程退出（码 ${code}）`;
      }
    });
    proc.on('error', (e) => {
      lastError = e.message || '启动失败';
      if (child === proc) child = null;
    });
    return getStatus();
  } catch (e: any) {
    lastError = e?.message || '启动失败';
    return { running: false, pid: null, error: lastError, port: HELPER_PORT };
  }
}

export function stop(): NativeAssistantStatus {
  if (child) {
    const c = child;
    try {
      c.kill('SIGTERM');
      // 兜底：2 秒后若仍未退出则强杀
      setTimeout(() => { try { if (!c.killed) c.kill('SIGKILL'); } catch { /* ignore */ } }, 2000);
    } catch (e: any) { lastError = e?.message || '停止失败'; }
    child = null;
  }
  return { running: false, pid: null, error: lastError, port: HELPER_PORT };
}
