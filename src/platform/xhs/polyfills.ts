// 老安卓（Chrome 61）缺、但页面里实际用到的几个小功能：只补用到的，不引整套 polyfill。
// - Array.prototype.flat / flatMap（Chrome 69）
// - ResizeObserver（Chrome 64）：退化成「窗口大小变了 / 首次」时回调，够图纸区和导航量尺寸用

type AnyFn = (...a: unknown[]) => unknown;

if (typeof (Array.prototype as { flat?: unknown }).flat !== 'function') {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true, writable: true,
    value: function flat(this: unknown[], depth = 1): unknown[] {
      const out: unknown[] = [];
      const add = (arr: unknown[], d: number) => {
        for (const v of arr) {
          if (Array.isArray(v) && d > 0) add(v, d - 1);
          else out.push(v);
        }
      };
      add(this, depth);
      return out;
    },
  });
}

if (typeof (Array.prototype as { flatMap?: unknown }).flatMap !== 'function') {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true, writable: true,
    value: function flatMap(this: unknown[], fn: AnyFn, thisArg?: unknown): unknown[] {
      const out: unknown[] = [];
      for (let i = 0; i < this.length; i++) {
        const v = fn.call(thisArg, this[i], i, this);
        if (Array.isArray(v)) out.push(...v);
        else out.push(v);
      }
      return out;
    },
  });
}

if (typeof (window as { ResizeObserver?: unknown }).ResizeObserver !== 'function') {
  class MiniResizeObserver {
    private cb: AnyFn;
    private els = new Set<Element>();
    private onResize = () => this.fire();
    constructor(cb: AnyFn) { this.cb = cb; }
    private fire() {
      if (!this.els.size) return;
      this.cb([...this.els].map(target => ({ target, contentRect: target.getBoundingClientRect() })), this);
    }
    observe(el: Element) {
      if (!this.els.size) window.addEventListener('resize', this.onResize);
      this.els.add(el);
      requestAnimationFrame(() => this.fire());
    }
    unobserve(el: Element) {
      this.els.delete(el);
      if (!this.els.size) window.removeEventListener('resize', this.onResize);
    }
    disconnect() {
      this.els.clear();
      window.removeEventListener('resize', this.onResize);
    }
  }
  (window as { ResizeObserver?: unknown }).ResizeObserver = MiniResizeObserver;
}

export {};
