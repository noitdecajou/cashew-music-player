export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
};
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];
export const setText = (element: Element, value: string): void => { if (element.textContent !== value) element.textContent = value; };

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element, props);
  element.append(...children);
  return element;
}

export function coverImage(url: string, className = 'thumb'): HTMLImageElement {
  const img = el('img', { className, alt: '', loading: 'lazy', decoding: 'async' });
  if (url) img.src = url;
  if (!url) img.classList.add('missing');
  img.addEventListener('error', () => img.classList.add('missing'), { once: true });
  return img;
}
