/**
 * ELECTROBUN SURFACE TYPES — hand-written shape of the `electrobun/bun` API this repo uses.
 *
 * Pinned electrobun@1.18.1 ships raw .ts sources (dist/api/bun/index.ts) that fail this
 * repo's strict `tsc` gate (FFI typings, three submodules; `skipLibCheck` only covers .d.ts),
 * and a tsconfig `paths` shim would ALSO hijack Bun's runtime resolution of the specifier.
 * So main.ts loads the module through a NON-LITERAL dynamic import (kept out of the type
 * graph) and narrows the result to this surface. Schema/config types are re-used from
 * `electrobun/view`, which type-checks clean — main.ts and view/index.ts therefore agree
 * on the SAME `DesktopRPCSchema` constraint.
 */

import type { ElectrobunRPCConfig, ElectrobunRPCSchema } from 'electrobun/view';

/** Main-process RPC surface: bun → view messages only (no bun → view requests). */
export interface BunRPC<Schema extends ElectrobunRPCSchema> {
  setTransport: (transport: unknown) => void
  send: <M extends keyof Schema['webview']['messages']>(
    message: M,
    payload: Schema['webview']['messages'][M],
  ) => void
}

export interface BrowserViewApi {
  defineRPC: <Schema extends ElectrobunRPCSchema>(
    config: ElectrobunRPCConfig<Schema, 'bun'>,
  ) => BunRPC<Schema>
}

export interface BrowserWindowOptions {
  title: string
  url: string
  frame: { x: number, y: number, width: number, height: number }
  rpc?: unknown
}

export interface BrowserWindowLike {
  readonly id: number
  /** Subscribes to a per-window event, e.g. `win.on('close', …)` (fires before the global `close`). */
  on: (name: string, handler: (event: unknown) => void) => void
}

export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

/** Vetoable app-quit event: `event.response = { allow: false }` cancels `Utils.quit()`. */
export interface ElectrobunEvent {
  name: string
  data: unknown
  response?: { allow: boolean }
  responseWasSet: boolean
}

/** The subset of `electrobun/bun`'s exports this repo consumes. */
export interface ElectrobunBunSurface {
  default: {
    events: {
      on: (event: string, listener: (event: ElectrobunEvent) => void) => void
    }
  }
  BrowserView: BrowserViewApi
  BrowserWindow: new <T>(options: BrowserWindowOptions & { rpc?: T }) => BrowserWindowLike
  Screen: {
    getPrimaryDisplay: () => { workArea: DisplayWorkArea }
  }
}
