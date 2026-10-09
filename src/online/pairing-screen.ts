/** Online-unpaired screen: paste the pairing URL or the bare code → validate → hand it to boot. */

import { extractCodeFromInput } from './pairing.ts';

const ERROR_TEXT = 'Código inválido — se esperan 26 caracteres (A–Z, 2–7) o la URL de pairing completa';

/**
 * Render the pairing screen into `#app` and wire the form. The code is written to the URL
 * fragment only (`history.replaceState`) — never localStorage: the fragment never reaches any
 * server, and closing the tab forgets the session (the URL itself already survives reloads).
 */
export function renderPairingScreen(onPaired: (code: string) => void): void {
  const app = document.getElementById('app');
  if (!app) { return; }
  app.innerHTML = `
    <div class="pairing">
      <h1>Harness Manager</h1>
      <p class="pairing-hint">Pegá la URL de pairing que imprimió el motor (o solo el código de 26 caracteres) para conectar de forma cifrada.</p>
      <form id="pairing-form" novalidate>
        <input id="pairing-input" class="pairing-input" type="text" placeholder="https://…/#c=…  o  ABCDEFGHJKMNPQRSTVWXYZ2345" autocomplete="off" spellcheck="false" />
        <div class="pairing-error" id="pairing-error" hidden></div>
        <button class="pairing-connect" type="submit">Conectar</button>
      </form>
    </div>`;

  const form = document.getElementById('pairing-form') as HTMLFormElement;
  const input = document.getElementById('pairing-input') as HTMLInputElement;
  const errorEl = document.getElementById('pairing-error') as HTMLElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = extractCodeFromInput(input.value);
    if (code === null) {
      errorEl.textContent = ERROR_TEXT;
      errorEl.hidden = false;
      input.focus();
      return;
    }
    errorEl.hidden = true;
    // Keep query params (mode/relay test overrides) and replace only the fragment.
    history.replaceState(null, '', `${location.pathname}${location.search}#c=${code}`);
    onPaired(code);
  });

  input.focus();
}
