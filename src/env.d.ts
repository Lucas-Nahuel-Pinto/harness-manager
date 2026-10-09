/**
 * Build-time globals injected by Vite (`define` in vite.config.ts).
 * `__HM_ONLINE__` is `true` only in `vite build --mode online` (dist-online/); it is undefined
 * under `bun test`, so runtime call sites guard it with `typeof`.
 */
declare const __HM_ONLINE__: boolean;
