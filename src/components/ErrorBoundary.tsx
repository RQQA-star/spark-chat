import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * 全局错误边界：任何一个组件崩溃都不会导致整页白屏，
 * 而是展示可操作的降级提示，并可尝试重载。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('应用运行时错误:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen w-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
          <div className="max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl" style={{ backgroundColor: '#e34d59', color: '#fff' }}>!</div>
            <div className="text-lg font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>页面出了一点问题</div>
            <div className="text-sm break-words" style={{ color: 'var(--td-text-color-secondary)' }}>{this.state.error.message}</div>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-lg text-white text-sm"
              style={{ backgroundColor: '#07c160' }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
