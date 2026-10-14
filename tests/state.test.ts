import { beforeEach, describe, expect, test } from 'bun:test';
import { getState, select, setDetailCollapsed } from '../src/state.ts';

describe('select — detail panel toggle', () => {
  beforeEach(() => {
    select(null);
    setDetailCollapsed(false);
  });

  test('clicking an element selects it', () => {
    select('mcp:.mcp.json:context7');
    expect(getState().selectedId).toBe('mcp:.mcp.json:context7');
  });

  test('clicking the same element with the panel open closes it', () => {
    select('agent:opencode.jsonc');
    select('agent:opencode.jsonc');
    expect(getState().selectedId).toBeNull();
  });

  test('closing by re-click keeps the panel expanded (next click shows details again)', () => {
    select('agent:opencode.jsonc');
    select('agent:opencode.jsonc');
    expect(getState().detailCollapsed).toBe(false);
    select('agent:opencode.jsonc');
    expect(getState().selectedId).toBe('agent:opencode.jsonc');
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
