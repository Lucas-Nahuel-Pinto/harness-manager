/** Pure unified diff — no deps, no I/O. Config-sized inputs (line LCS after prefix/suffix trim). */

type OpKind = 'ctx' | 'del' | 'add';

interface Op {
  kind: OpKind
  line: string
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split('\n');
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: 'ctx', line: a[i] }); i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { ops.push({ kind: 'del', line: a[i] }); i++; }
    else { ops.push({ kind: 'add', line: b[j] }); j++; }
  }
  while (i < n) { ops.push({ kind: 'del', line: a[i] }); i++; }
  while (j < m) { ops.push({ kind: 'add', line: b[j] }); j++; }
  return ops;
}

function diffOps(oldLines: string[], newLines: string[]): Op[] {
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) { prefix++; }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) { suffix++; }

  const middle = lcsOps(oldLines.slice(prefix, oldLines.length - suffix), newLines.slice(prefix, newLines.length - suffix));
  const head = oldLines.slice(0, prefix).map((line): Op => ({ kind: 'ctx', line }));
  const tail = oldLines.slice(oldLines.length - suffix).map((line): Op => ({ kind: 'ctx', line }));
  return [...head, ...middle, ...tail];
}

const CONTEXT = 3;

/** Unified diff with `--- a/<relPath>` / `+++ b/<relPath>` headers. Empty string when equal. */
export function unifiedDiff(oldText: string, newText: string, relPath: string): string {
  if (oldText === newText) { return ''; }

  const ops = diffOps(splitLines(oldText), splitLines(newText));
  const changed: number[] = [];
  ops.forEach((op, index) => { if (op.kind !== 'ctx') { changed.push(index); } });
  if (changed.length === 0) { return ''; }

  // Group changes whose context windows overlap or touch.
  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, changed[0] - CONTEXT);
  let end = Math.min(ops.length, changed[0] + CONTEXT + 1);
  for (const index of changed.slice(1)) {
    const groupStart = Math.max(0, index - CONTEXT);
    if (groupStart <= end) {
      end = Math.min(ops.length, index + CONTEXT + 1);
    }
    else {
      ranges.push([start, end]);
      start = groupStart;
      end = Math.min(ops.length, index + CONTEXT + 1);
    }
  }
  ranges.push([start, end]);

  const out: string[] = [`--- a/${relPath}`, `+++ b/${relPath}`];
  for (const [from, to] of ranges) {
    let oldLine = 1;
    let newLine = 1;
    for (let k = 0; k < from; k++) {
      if (ops[k].kind !== 'add') { oldLine++; }
      if (ops[k].kind !== 'del') { newLine++; }
    }
    const oldStartAt = oldLine;
    const newStartAt = newLine;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = from; k < to; k++) {
      const op = ops[k];
      if (op.kind === 'ctx') { body.push(` ${op.line}`); oldCount++; newCount++; }
      else if (op.kind === 'del') { body.push(`-${op.line}`); oldCount++; }
      else { body.push(`+${op.line}`); newCount++; }
    }
    const oldHeader = oldCount === 0 ? Math.max(0, oldStartAt - 1) : oldStartAt;
    const newHeader = newCount === 0 ? Math.max(0, newStartAt - 1) : newStartAt;
    out.push(`@@ -${oldHeader},${oldCount} +${newHeader},${newCount} @@`, ...body);
  }
  return out.join('\n');
}
