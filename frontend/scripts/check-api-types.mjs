// Fails if src/api/generated/schema.ts is out of date with ../openapi.yaml.
// API types are never written by hand (ADR-0005); regenerate them with `npm run api:types`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const committed = 'src/api/generated/schema.ts';
const dir = mkdtempSync(join(tmpdir(), 'api-types-'));
const fresh = join(dir, 'schema.ts');

try {
  execFileSync(
    process.execPath,
    ['node_modules/openapi-typescript/bin/cli.js', '../openapi.yaml', '--output', fresh],
    { stdio: 'pipe' },
  );
  const normalise = (text) => text.replace(/\r\n/g, '\n');
  if (normalise(readFileSync(fresh, 'utf8')) !== normalise(readFileSync(committed, 'utf8'))) {
    console.error(`${committed} is out of date with ../openapi.yaml. Run: npm run api:types`);
    process.exitCode = 1;
  } else {
    console.log(`${committed} matches ../openapi.yaml`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
