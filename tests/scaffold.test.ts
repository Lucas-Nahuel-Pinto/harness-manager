import { describe, expect, test } from 'bun:test';

describe('scaffold', () => {
  test('package.json exposes the pipeline commands', async () => {
    const pkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
      scripts: Record<string, string>
    };
    for (const script of ['pull', 'agent', 'engine', 'build:online', 'test', 'types:check', 'lint', 'repo:check']) {
      expect(pkg.scripts[script]).toBeString();
    }
  });

  test('index.html mounts the app root', async () => {
    const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
    expect(html).toContain('id="app"');
    expect(html).toContain('/src/main.ts');
  });
});
