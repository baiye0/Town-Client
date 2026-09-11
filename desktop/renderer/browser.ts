import './browser.css';
import { mountBrowserSplit } from './browser-split';
import type { BrowserAction, BrowserState, DesktopAPI } from '../shared';

export function mountBrowser(api: DesktopAPI, report: (error: unknown) => void) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $('browser-panel'), viewport = $('browser-viewport');
  const address = $<HTMLInputElement>('browser-address');
  let state: BrowserState;
  let scheduled = false;
  let dragging = false;
  const sendBounds = () => {
    const { x, y, width, height } = viewport.getBoundingClientRect();
    void api.browserBounds({ x, y, width, height, visible: !dragging && !panel.hidden && !$('client-main').hidden && !document.querySelector('dialog[open]') }).catch(report);
  };
  const layout = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sendBounds();
    });
  };
  const split = mountBrowserSplit(panel, active => { dragging = active; sendBounds(); });
  const render = (next: BrowserState) => {
    state = next;
    panel.hidden = !next.open;
    split(next.open);
    $('browser-title').textContent = next.title;
    if (document.activeElement !== address) address.value = next.address;
    $<HTMLButtonElement>('browser-back').disabled = !next.canGoBack;
    $<HTMLButtonElement>('browser-forward').disabled = !next.canGoForward;
    $<HTMLButtonElement>('browser-external').disabled = !next.address;
    $('browser-reload').textContent = next.loading ? '×' : '↻';
    $('browser-reload').setAttribute('aria-label', next.loading ? '停止加载' : '刷新网页');
    $('browser-message').textContent = next.error || (next.loading ? '正在加载网页…' : next.address ? '' : '输入网址，或从更多选项打开原版 Loom、小镇说明。');
    layout();
  };
  const act = (action: BrowserAction) => void api.browserAction(action).catch(report);
  for (const action of ['back', 'forward', 'external', 'close'] as const) $('browser-' + action).onclick = () => act(action);
  $('browser-reload').onclick = () => act(state?.loading ? 'stop' : 'reload');
  $('browser-address-form').onsubmit = event => {
    event.preventDefault();
    const value = address.value;
    address.blur();
    if (value === state?.address) act('reload');
    else void api.openBrowser(value).catch(report);
  };
  $('open-browser').onclick = () => void api.openBrowser().then(() => { address.focus(); address.select(); }).catch(report);
  api.onBrowser(render);
  void api.browserState().then(render).catch(report);
  new ResizeObserver(layout).observe(viewport);
  window.addEventListener('resize', layout);
  const observer = new MutationObserver(layout);
  for (const dialog of document.querySelectorAll('dialog')) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
  observer.observe($('client-main'), { attributes: true, attributeFilter: ['hidden'] });
}
