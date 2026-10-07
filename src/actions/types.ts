import type { HarnessSnapshot } from '../types.ts';

/** A fully computed mutation: old/new text for one guarded file, ready to diff. */
export interface ComputedEdit {
  /** path relative to harness root (posix-style, as scanned) */
  relPath: string
  /** absolute path (already guarded by the compute function) */
  absPath: string
  oldText: string
  newText: string
  /** one-line human summary shown next to the diff */
  summary: string
}

export type ComputeResult
  = { ok: true, computed: ComputedEdit }
    | { ok: false, status: number, code: string, detail: string };

/** HTTP-facing body — every route answers with one of these shapes. */
export interface ApiBody {
  ok: boolean
  stage?: string
  diff?: string
  summary?: string
  snapshot?: HarnessSnapshot
  error?: string
  detail?: string
  output?: string
  exitCode?: number | null
}

export interface ActionResult {
  status: number
  body: ApiBody
}

export function okEdit(computed: ComputedEdit): ComputeResult {
  return { ok: true, computed };
}

export function fail(status: number, code: string, detail: string): ComputeResult {
  return { ok: false, status, code, detail };
}

export function errorResult(status: number, code: string, detail: string): ActionResult {
  return { status, body: { ok: false, error: code, detail } };
}
