// 兜底：页面里任何一处渲染出错，不让整页白屏，给一句说明和刷新按钮
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1 className="title">页面出了点问题</h1>
        <p className="lede">刷新一下通常就好了。如果一直这样，可能是浏览器里存的收藏数据坏了，可以在浏览器设置里清除本站数据后再试。</p>
        <button className="btn primary pill" onClick={() => window.location.reload()}>刷新页面</button>
      </div>
    );
  }
}
