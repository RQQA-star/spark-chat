/**
 * 本机远程协助 · 原生键鼠注入工具（仅 remoteAssist 模式可用）
 * ----------------------------------------------------------
 * 通过 agent-sdk 的「SDK MCP Server」机制，向 Agent 注册一个 inject_input 工具。
 * 当 Agent 在 bypassPermissions 的本机协助模式下调用该工具时，本模块把事件转发到
 * 本机项目自带的 native-assistant/assist-helper.js（监听 ws://127.0.0.1:17890），
 * 由它把事件还原为<b>真实操作系统级</b>鼠标 / 键盘输入——从而让 AI 能驱动 GUI 程序，
 * 而不只是执行命令行 / 读写文件。
 *
 * 安全约束：
 * - 仅在本机远程协助（remoteAssist）会话中挂载，绝不污染普通 Agent 会话；
 * - 只连接项目自带的 127.0.0.1:17890，绝不接受任意地址；
 * - 原生助手由 server/nativeAssistant.ts 统一管理（进程级单例、硬编码脚本路径）。
 */
import { tool, createSdkMcpServer, type SdkMcpServerResult } from '@tencent-ai/agent-sdk';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import * as nativeAssistant from './nativeAssistant.js';

const HELPER_WS = 'ws://127.0.0.1:17890';

// 进程级复用一条到 assist-helper 的 WebSocket（懒连接，断线自动重连）
// 注：本机 @types/ws 8.18.1 的 WebSocket 客户端类型不稳定（构造函数参数与
// onopen/onerror/onclose 缺失），此处用 any 规避，运行期行为以 ws 实际实现为准。
let ws: any = null;
let wsReady: Promise<boolean> | null = null;

/** 确保原生助手已运行（已运行则直接返回，否则尝试拉起） */
function ensureHelper(): { ok: boolean; error?: string } {
  const st = nativeAssistant.getStatus();
  if (st.running) return { ok: true };
  const started = nativeAssistant.start();
  if (started.running) return { ok: true };
  return { ok: false, error: started.error || '原生助手未运行' };
}

/** 连接（或复用）到 assist-helper，返回是否就绪 */
function connectHelper(): Promise<boolean> {
  if (ws && ws.readyState === 1) return Promise.resolve(true);
  if (wsReady) return wsReady;
  wsReady = new Promise<boolean>((resolve) => {
    try {
      const sock: any = new (WebSocket as any)(HELPER_WS);
      ws = sock;
      sock.onopen = () => resolve(true);
      sock.onerror = () => { wsReady = null; ws = null; resolve(false); };
      sock.onclose = () => { wsReady = null; ws = null; };
    } catch {
      wsReady = null; ws = null; resolve(false);
    }
  });
  return wsReady;
}

/** 向助手发送一个注入事件；返回结果 */
async function inject(ev: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const pre = ensureHelper();
  if (!pre.ok) return { ok: false, error: pre.error };
  const connected = await connectHelper();
  if (!connected || !ws) return { ok: false, error: '无法连接原生注入助手（127.0.0.1:17890）' };
  try {
    ws.send(JSON.stringify(ev));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '发送失败' };
  }
}

interface InjectInputArgs {
  action: 'move' | 'down' | 'up' | 'drag' | 'wheel' | 'key' | 'type';
  x?: number; y?: number; deltaY?: number; key?: string; text?: string;
}

const injectInputHandler = async ({ action, x, y, deltaY, key, text }: InjectInputArgs): Promise<CallToolResult> => {
  let result: { ok: boolean; error?: string } | undefined;
  switch (action) {
    case 'move': result = await inject({ type: 'mouse', x, y }); break;
    case 'down': result = await inject({ type: 'mousedown' }); break;
    case 'up': result = await inject({ type: 'mouseup' }); break;
    case 'drag': result = await inject({ type: 'drag', x, y }); break;
    case 'wheel': result = await inject({ type: 'wheel', deltaY }); break;
    case 'key': result = await inject({ type: 'key', key }); break;
    case 'type': {
      const chars = (text || '').split('');
      let ok = true; let lastErr: string | undefined;
      for (const c of chars) { const r = await inject({ type: 'key', key: c }); if (!r.ok) { ok = false; lastErr = r.error; } }
      result = ok ? { ok: true } : { ok: false, error: lastErr };
      break;
    }
  }
  if (!result?.ok) {
    return {
      content: [{
        type: 'text',
        text: `⚠️ 注入失败：${result?.error || '未知错误'}。请确认已在 native-assistant 目录执行 npm install 并启动原生助手（依赖 @nut-tree-fork/nut-js）。`,
      }],
    };
  }
  const at = x !== undefined && y !== undefined ? ` @(${Number(x).toFixed(3)}, ${Number(y).toFixed(3)})` : '';
  return { content: [{ type: 'text', text: `已向本机注入 ${action}${at}` }] };
};

/**
 * 构建供 query() 注入的 SDK MCP Server（含 inject_input 工具）。
 * 仅在 remoteAssist 会话中调用（懒注册 tool，避免模块加载时触碰 SDK mock）；
 * 调用方负责把返回的 server 挂到 options.mcpServers。
 */
export function buildRemoteAssistMcpServer(): SdkMcpServerResult {
  const injectInputTool = tool(
    'inject_input',
    '向本机操作系统注入真实键鼠输入（仅在本机远程协助模式下可用）。用于驱动无法通过命令行控制的 GUI 程序。' +
    '鼠标坐标 x/y 为 0~1 的归一化值（屏幕左上角 0,0，右下角 1,1）。',
    {
      action: z.enum(['move', 'down', 'up', 'drag', 'wheel', 'key', 'type']).describe('操作类型：move 移动 / down 按下 / up 抬起 / drag 拖拽 / wheel 滚轮 / key 单键 / type 键入字符串'),
      x: z.number().min(0).max(1).optional().describe('鼠标 X 归一化坐标（0~1），move/drag 时使用'),
      y: z.number().min(0).max(1).optional().describe('鼠标 Y 归一化坐标（0~1），move/drag 时使用'),
      deltaY: z.number().optional().describe('滚轮滚动量，正数向下、负数向上，wheel 时使用'),
      key: z.string().optional().describe('单个按键名，如 Enter / Backspace / ArrowLeft / a，key 时使用'),
      text: z.string().optional().describe('要键入的字符串，type 时使用（逐字符注入）'),
    },
    injectInputHandler,
  );
  return createSdkMcpServer({ name: 'native-input', tools: [injectInputTool] });
}
