/**
 * DESKTOP RPC SCHEMA — shared request/response + push-message types (spec §3.4/§3.8).
 *
 * Used by BOTH sides of the Electrobun RPC bridge: main.ts handles `bun.requests`
 * and pushes `webview.messages.state`; view/index.ts calls the requests and renders
 * the pushed snapshots. Pure types only (type-only imports) — bundling the view
 * never pulls main-process code.
 */

import type { ElectrobunRPCSchema } from 'electrobun/view';
import type { BrowseErrorCode } from '../agent/browse.ts';
import type { RecentEntry } from '../agent/recents.ts';
import type { ControllerState, PickResult } from './controller.ts';

export type DesktopPickResult = PickResult;

/** Browse outcome, mirroring the launcher's POST /api/browse contract. */
export type BrowseResult
  = | { ok: true, path: string }
    | { ok: true, cancelled: true }
    | { ok: false, error: BrowseErrorCode, detail: string };

/** Everything the view needs to render one full frame. Pushed on every state change. */
export interface DesktopSnapshot {
  state: ControllerState
  root: string | null
  recents: RecentEntry[]
  pairingUrl: string | null
  detail: string | null
}

/**
 * Single schema for both RPC sides (electrobun@1.18.1 `ElectrobunRPCSchema`):
 * view → bun requests live under `bun.requests`; bun → view pushes under
 * `webview.messages`. `webview.requests` / `bun.messages` stay empty.
 */
export interface DesktopRPCSchema extends ElectrobunRPCSchema {
  bun: {
    requests: {
      getInitial: { params: void, response: DesktopSnapshot }
      pickRoot: { params: { path: string }, response: DesktopPickResult }
      browse: { params: void, response: BrowseResult }
      openApp: { params: void, response: { ok: boolean } }
      reset: { params: void, response: { ok: boolean } }
      quit: { params: void, response: { ok: boolean } }
    }
    messages: Record<string, never>
  }
  webview: {
    requests: Record<string, never>
    messages: {
      state: DesktopSnapshot
    }
  }
}
