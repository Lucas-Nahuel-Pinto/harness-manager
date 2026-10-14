import { beforeEach, describe, expect, test } from 'bun:test';
import { getState, select, setDetailCollapsed, toggleWarnings } from '../src/state.ts';

describe('select — detail panel toggle', () => {
  beforeEach(() => {
    select(null);
    setDetailCollapsed(false);
  });

  test('clicking an element selects it', () => {
    select('mcp:.mcp.json:context7');
    expect(getState().selectedId).toBe('mcp:.mcp.json:context7');
  });

  test('clicking the same element with the panel open collapses the panel', () => {
    select('agent:opencode.jsonc');
    select('agent:opencode.jsonc');
    expect(getState().selectedId).toBeNull();
    expect(getState().detailCollapsed).toBe(true); // the whole panel folds, not just the content
  });

  test('closing by re-click collapses; the next click re-opens it with details', () => {
    select('agent:opencode.jsonc');
    select('agent:opencode.jsonc');
    expect(getState().detailCollapsed).toBe(true);
    select('agent:opencode.jsonc');
    expect(getState().selectedId).toBe('agent:opencode.jsonc');
    expect(getState().detailCollapsed).toBe(false);
  });

  test('clicking another element while open switches the selection', () => {
    select('agent:opencode.jsonc');
    select('skill:demo');
    expect(getState().selectedId).toBe('skill:demo');
  });

  test('a collapsed panel un-collapses automatically on click', () => {
    setDetailCollapsed(true);
    select('mcp:opencode.jsonc:tavily');
    expect(getState().detailCollapsed).toBe(false);
    expect(getState().selectedId).toBe('mcp:opencode.jsonc:tavily');
  });

  test('re-click with the panel COLLAPSED re-opens it instead of closing', () => {
    select('script:lint');
    setDetailCollapsed(true); // user folded the panel while the element stayed selected
    select('script:lint');
    expect(getState().selectedId).toBe('script:lint');
    expect(getState().detailCollapsed).toBe(false);
  });

  test('select(null) clears the selection and never un-collapses', () => {
    select('agent:opencode.jsonc');
    setDetailCollapsed(true);
    select(null);
    expect(getState().selectedId).toBeNull();
    expect(getState().detailCollapsed).toBe(true);
  });
});

describe('toggleWarnings — Alertas button panel toggle', () => {
  beforeEach(() => {
    select(null);
    setDetailCollapsed(false);
  });

  test('clicking Alertas shows the alerts AND un-collapses the panel', () => {
    setDetailCollapsed(true); // panel folded beforehand
    toggleWarnings();
    expect(getState().showWarnings).toBe(true);
    expect(getState().detailCollapsed).toBe(false);
    expect(getState().selectedId).toBeNull();
  });

  test('re-clicking Alertas with the alerts visible collapses the panel', () => {
    toggleWarnings();
    toggleWarnings();
    expect(getState().showWarnings).toBe(false);
    expect(getState().detailCollapsed).toBe(true);
  });

  test('re-clicking Alertas after the collapse re-opens the alerts', () => {
    toggleWarnings();
    toggleWarnings(); // collapsed
    toggleWarnings();
    expect(getState().showWarnings).toBe(true);
    expect(getState().detailCollapsed).toBe(false);
  });

  test('re-click with the panel MANUALLY collapsed re-opens instead of closing', () => {
    toggleWarnings();
    setDetailCollapsed(true); // user folded the panel while alerts stayed on
    toggleWarnings();
    expect(getState().showWarnings).toBe(true);
    expect(getState().detailCollapsed).toBe(false);
  });

  test('Alertas takes over from an open element selection', () => {
    select('agent:opencode.jsonc');
    toggleWarnings();
    expect(getState().showWarnings).toBe(true);
    expect(getState().selectedId).toBeNull();
    expect(getState().detailCollapsed).toBe(false);
  });

  test('selecting an element hides the alerts view', () => {
    toggleWarnings();
    select('skill:demo');
    expect(getState().showWarnings).toBe(false);
    expect(getState().selectedId).toBe('skill:demo');
  });
});
