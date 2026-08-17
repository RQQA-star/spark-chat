/**
 * spark-chat 原生键鼠注入助手（被控端运行）
 * ----------------------------------------------------------
 * 被控端浏览器在收到控制端的输入事件后，会通过 WebSocket 把事件转发到本进程；
 * 本进程用 nut.js 把事件还原成<b>真实的操作系统级</b>鼠标移动 / 点击 / 滚轮 / 键盘输入。
 *
 * 这是「真·跨机控制」的关键一环：浏览器 JS 本身无法向操作系统注入键鼠，
 * 必须由一个本地原生进程来完成。控制端 →(WebRTC)→ 被控端浏览器 →(localhost WS)→ 本进程 → 真实 OS 输入。
 *
 * 运行：在被控机上 `cd native-assistant && npm install && npm start`
 * 监听：ws://127.0.0.1:17890
 */
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';
import fs from 'fs';
import { mouse, keyboard, Point, screen, Key, Button } from '@nut-tree-fork/nut-js';

const PORT = 17890;

async function screenSize() {
  try {
    const w = await screen.width();
    const h = await screen.height();
    if (w && h) return { w, h };
  } catch (e) { /* ignore */ }
  return { w: 1920, h: 1080 };
}

function mapKey(key) {
  switch (key) {
    case 'Enter': return Key.Enter;
    case 'Backspace': return Key.Backspace;
    case 'Tab': return Key.Tab;
    case 'Escape': return Key.Escape;
    case 'Delete': return Key.Delete;
    case 'ArrowUp': return Key.Up;
    case 'ArrowDown': return Key.Down;
    case 'ArrowLeft': return Key.Left;
    case 'ArrowRight': return Key.Right;
    default: return null;
  }
}

async function apply(ev) {
  const { w, h } = await screenSize();
  switch (ev.type) {
    case 'mouse': {
      const x = Math.max(0, Math.min(w, ev.x * w));
      const y = Math.max(0, Math.min(h, ev.y * h));
      await mouse.move(new Point(x, y), { steps: 4 });
      break;
    }
    case 'mousedown': await mouse.pressButton(Button.LEFT); break;
    case 'mouseup': await mouse.releaseButton(Button.LEFT); break;
    case 'drag': {
      const x = Math.max(0, Math.min(w, ev.x * w));
      const y = Math.max(0, Math.min(h, ev.y * h));
      await mouse.move(new Point(x, y), { steps: 2 });
      break;
    }
    case 'wheel': {
      const amount = Math.max(1, Math.min(20, Math.round(Math.abs(ev.deltaY) / 60)));
      if (ev.deltaY > 0) await mouse.scrollDown(amount);
      else await mouse.scrollUp(amount);
      break;
    }
    case 'key': {
      if (!ev.key) break;
      const k = mapKey(ev.key);
      if (k) { await keyboard.pressKey(k); }
      else if (ev.key.length === 1) { await keyboard.type(ev.key); }
      break;
    }
    default: break;
  }
}

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('connection', (ws) => {
  console.log(`[assist] 被控端浏览器已连接（客户端数 ${wss.clients.size}）`);
  screenSize().then(s => ws.send(JSON.stringify({ type: 'ready', screen: s })));

  // 跨机远程协助：执行来自控制端（经服务器中转）的结构化 action，并回传结果。
  // 注意：这些指令会在本机真实执行，仅在被控端主动「发起远程协助」并授权后才生效。
  const applyAction = async (msg) => {
    const { actionId, action, params = {} } = msg;
    try {
      let output = '';
      if (action === 'run_command') {
        output = await runCommand(params.command);
      } else if (action === 'read_file') {
        output = await fs.promises.readFile(params.path, 'utf8');
      } else if (action === 'write_file') {
        await fs.promises.writeFile(params.path, params.content || '', 'utf8');
        output = `已写入 ${params.path}（${Buffer.byteLength(params.content || '', 'utf8')} 字节）`;
      } else {
        ws.send(JSON.stringify({ type: 'action_result', actionId, ok: false, error: '不支持的 action: ' + action }));
        return;
      }
      ws.send(JSON.stringify({ type: 'action_result', actionId, ok: true, output: String(output) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'action_result', actionId, ok: false, error: e?.message || String(e) }));
    }
  };

  ws.on('message', async (raw) => {
    try {
      const ev = JSON.parse(raw.toString());
      if (ev.type === 'action') { await applyAction(ev); }
      else { await apply(ev); }
    } catch (e) {
      console.error('[assist] 处理事件失败:', e?.message || e);
    }
  });
  ws.on('close', () => console.log(`[assist] 连接断开（剩余 ${wss.clients.size}）`));
  ws.on('error', (e) => console.error('[assist] socket 错误:', e?.message || e));
});

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    if (!cmd || typeof cmd !== 'string') return reject(new Error('command 不能为空'));
    exec(cmd, { maxBuffer: 5 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve((stdout || '') + (stderr ? '\n[stderr]\n' + stderr : ''));
    });
  });
}

console.log(`✅ 原生键鼠注入助手已启动，监听 ws://127.0.0.1:${PORT}`);
console.log('   被控端浏览器需开启「原生注入」，才会把输入转发到这里。');
