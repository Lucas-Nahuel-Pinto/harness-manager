import { escapeHtml } from '../html.ts';

interface ModalOptions {
  title: string
  bodyHtml: string
  confirmLabel?: string
  cancelLabel?: string
  /** Wire custom controls (e.g. copy buttons) after the overlay is in the DOM. */
  onMount?: (overlay: HTMLElement) => void
}

/** Shared overlay dialog. Resolves true on confirm (or the single close button), false on cancel/backdrop/Escape. */
async function runModal(options: ModalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3 class="modal-title"></h3>
        <div class="modal-body">${options.bodyHtml}</div>
        <div class="modal-actions">
          ${options.cancelLabel ? `<button class="modal-cancel">${escapeHtml(options.cancelLabel)}</button>` : ''}
          <button class="modal-confirm">${escapeHtml(options.confirmLabel ?? 'Cerrar')}</button>
        </div>
      </div>`;

    let settled = false;
    function close(result: boolean): void {
      if (settled) { return; }
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      previousFocus?.focus?.();
      resolve(result);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
    }

    overlay.querySelector<HTMLElement>('.modal-title')!.textContent = options.title;
    overlay.querySelector<HTMLButtonElement>('.modal-confirm')!.addEventListener('click', () => close(true));
    overlay.querySelector<HTMLButtonElement>('.modal-cancel')?.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) { close(false); } });
    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(overlay);
    options.onMount?.(overlay);
    overlay.querySelector<HTMLButtonElement>('.modal-confirm')?.focus();
  });
}

export interface ConfirmRequest {
  title: string
  summary: string
  diff: string
}

/** Stage-2 confirmation: one-line summary + unified diff, Aplicar / Cancelar. */
export async function confirmModal(request: ConfirmRequest): Promise<boolean> {
  const diffBlock = request.diff
    ? `<pre class="modal-diff">${escapeHtml(request.diff)}</pre>`
    : '<div class="modal-summary">(sin cambios — el archivo ya tiene el estado pedido)</div>';
  return runModal({
    title: request.title,
    bodyHtml: `<div class="modal-summary">${escapeHtml(request.summary)}</div>${diffBlock}`,
    confirmLabel: 'Aplicar',
    cancelLabel: 'Cancelar',
  });
}

const MAX_OUTPUT_CHARS = 20_000;

export interface ChoiceRequest {
  title: string
  bodyHtml: string
  confirmLabel?: string
  cancelLabel?: string
  onMount?: (overlay: HTMLElement) => void
}

/** Generic confirm/cancel dialog with arbitrary (already-escaped) body HTML. */
export async function choiceModal(request: ChoiceRequest): Promise<boolean> {
  return runModal(request);
}

/** Read-only output viewer (script runs). */
export async function alertModal(title: string, text: string): Promise<boolean> {
  const clipped = text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [salida truncada en la vista]`
    : text;
  return runModal({
    title,
    bodyHtml: `<pre class="modal-diff">${escapeHtml(clipped || '(sin salida)')}</pre>`,
    confirmLabel: 'Cerrar',
  });
}
