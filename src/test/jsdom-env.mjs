// 自定义 Vitest 环境：jsdom。
// 注意：本文件必须为 .mjs（纯 JS），因为 vitest worker 通过原生 node import() 加载环境模块，
// 不会经过 vite 转译 .ts。
//
// 加载策略（自适应，兼顾本机杀软规避与 CI/Linux）：
// - 优先尝试【项目外部】的 Windows 副本 D:/spark-jsdom/pkgs/jsdom：该副本为平铺布局，依赖靠
//   NODE_PATH 解析；本机杀软会损坏项目内 node_modules/jsdom，故仅在该隔离副本存在时使用它。
// - 否则回退到标准 `jsdom`（node_modules 内，CI/Linux 上通常是完好副本）。
// 这样同一份配置在「本机 Windows + 杀软」与「CI 容器 Linux」两种环境下都能跑通测试。
async function loadJSDOM() {
  const candidates = ['D:/spark-jsdom/pkgs/jsdom', 'jsdom'];
  let lastErr;
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      const JSDOM = mod.JSDOM || mod.default?.JSDOM;
      if (typeof JSDOM === 'function') return JSDOM;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    '无法加载 jsdom：已尝试 ' + candidates.join(' , ') + ' —— ' + (lastErr?.stack || lastErr),
  );
}

const JSDOM = await loadJSDOM();

function defineGlobal(global, key, value) {
  try {
    Object.defineProperty(global, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch {
    /* 部分全局只读，忽略 */
  }
}

const environment = {
  name: 'jsdom-custom',
  transformMode: 'web',
  async setup(global, options) {
    const envOptions = (options && options.jsdom) || {};
    const {
      html = '<!DOCTYPE html><html><head></head><body></body></html>',
      url = 'http://localhost/',
      contentType = 'text/html',
      userAgent,
      ...jsdomOptions
    } = envOptions;

    const dom = new JSDOM(html, {
      url,
      contentType,
      userAgent,
      pretendToBeVisual: true,
      ...jsdomOptions,
    });

    const { window } = dom;

    const globalKeys = Object.getOwnPropertyNames(window).filter(
      (k) => !k.startsWith('_') && !(k in global),
    );

    for (const key of globalKeys) {
      try {
        Object.defineProperty(global, key, {
          get: () => window[key],
          set: (v) => {
            window[key] = v;
          },
          configurable: true,
        });
      } catch {
        /* 跳过不可定义项 */
      }
    }

    defineGlobal(global, 'window', window);
    defineGlobal(global, 'document', window.document);
    defineGlobal(global, 'navigator', window.navigator);

    return {
      teardown(global) {
        try {
          window.close();
        } catch {
          /* noop */
        }
        for (const key of globalKeys) {
          try {
            delete global[key];
          } catch {
            /* noop */
          }
        }
        try {
          delete global.window;
          delete global.document;
          delete global.navigator;
        } catch {
          /* noop */
        }
      },
    };
  },
};

export default environment;
