type ToastKind = 'ok' | 'error' | 'info';

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container || !document.body.contains(container)) {
    container = document.createElement('div');
    container.className = 'toasts';
    document.body.appendChild(container);
  }
  return container;
}

/** Bottom-right transient toast (styles: `.toasts` / `.toast` in styles.ts). */
export function toast(message: string, kind: ToastKind = 'ok', ttlMs = 4000): void {
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' error' : ''}`;
  el.textContent = message;
  ensureContainer().appendChild(el);
  window.setTimeout(() => el.remove(), ttlMs);
}
