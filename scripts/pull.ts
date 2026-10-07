import type { HarnessSnapshot } from '../src/types.ts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Ajv from 'ajv';
import { scanHarness, snapshotPath, TOOL_VERSION } from '../src/scan/index.ts';

const REPO_ROOT = resolve(import.meta.dir, '..');

interface Args {
  root: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--root');
  const root = idx !== -1 && argv[idx + 1] ? resolve(argv[idx + 1]) : process.env.HARNESS_ROOT ?? process.cwd();
  return { root };
}

function validate(snapshot: HarnessSnapshot): string | null {
  const schemaFile = join(REPO_ROOT, 'harness.schema.json');
  const schema = JSON.parse(existsSync(schemaFile) ? readFileSync(schemaFile, 'utf8') : '{}') as Record<string, unknown>;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  if (validateFn(snapshot)) { return null; }
  return validateFn.errors?.map(e => `${e.instancePath} ${e.message}`).join('; ') ?? 'schema validation failed';
}

function abort(message: string): never {
  console.error(`ABORT: ${message}`);
  console.error('Last good snapshot (if any) left untouched.');
  process.exit(1);
}

function main(): void {
  const { root } = parseArgs();
  console.log(`harness-manager pull v${TOOL_VERSION}`);
  console.log(`root: ${root}`);

  const { snapshot, error } = scanHarness(root);
  if (error || !snapshot) { abort(error ?? 'scan produced no snapshot'); }

  const schemaError = validate(snapshot);
  if (schemaError) { abort(`schema validation: ${schemaError}`); }

  const out = snapshotPath(REPO_ROOT);
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(tmp, out);

  const counts = [
    `${snapshot.skills.length} skills`,
    `${snapshot.commands.length} commands`,
    `${snapshot.agents.length} agents`,
    `${snapshot.mcps.length} mcps`,
    `${snapshot.env.length} env vars`,
    `${snapshot.scripts.length} scripts`,
    `${snapshot.registries.length} registries`,
  ].join(' · ');
  console.log(counts);
  if (snapshot.meta.warnings.length) {
    console.log(`warnings (${snapshot.meta.warnings.length}):`);
    for (const w of snapshot.meta.warnings) { console.log(`  - ${w}`); }
  }
  console.log(`written: ${out}`);
}

main();
