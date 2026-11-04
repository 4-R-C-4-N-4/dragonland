// Small native-DOM stand-in: no renderer or jsdom needed.
export class ElementMock extends EventTarget {
  tagName: string;
  children: ElementMock[] = [];
  parent: ElementMock | null = null;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  open = false;
  value = '';
  private html = '';
  constructor(tag = 'div') { super(); this.tagName = tag; }
  set innerHTML(value: string) {
    this.html = value; this.children = [];
    for (const m of value.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const el = new ElementMock(m[1]); el.attrs.id = m[2]!; this.appendChild(el);
    }
  }
  get innerHTML() { return this.html; }
  appendChild<T extends ElementMock>(el: T): T { this.children.push(el); el.parent = this; return el; }
  append(...els: ElementMock[]) { els.forEach(el => this.appendChild(el)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  contains(el: ElementMock): boolean { return this === el || this.children.some(c => c.contains(el)); }
  querySelector(selector: string): ElementMock | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): ElementMock[] {
    const matches = (el: ElementMock) => selector.startsWith('#') ? el.attrs.id === selector.slice(1) : selector.startsWith('.') ? el.className.split(' ').includes(selector.slice(1)) : el.tagName === selector;
    return this.children.flatMap(c => [...(matches(c) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  focus() { dom.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  click() { this.dispatchEvent(new Event('click')); }
}
export const dom = Object.assign(new EventTarget(), { activeElement: null as ElementMock | null, createElement: (tag: string) => new ElementMock(tag) });
export function key(target: EventTarget, value: string) {
  const e = new Event('keydown', { cancelable: true }); Object.defineProperty(e, 'key', { value }); target.dispatchEvent(e); return e;
}
