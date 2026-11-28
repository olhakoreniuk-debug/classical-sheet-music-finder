// Enforces the dependency rule (architecture §6) without extra packages:
// - src/core/ imports nothing outside src/core/ (no pg, fetch, fs, crypto, adapters, cli);
// - src/cli/ imports only the core and Node built-ins (never an adapter);
// - src/adapters/ never import src/cli/.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  }));
  return nested.flat();
}

async function importsOf(file) {
  const text = await readFile(file, 'utf8');
  return [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2]);
}

/** The src/ layer an import resolves to ('core', 'cli', 'adapters', ...), or null for packages/built-ins. */
function layerOf(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = relative(SRC, resolve(dirname(file), specifier));
  return target.startsWith('..') ? 'outside-src' : target.split(/[\\/]/)[0];
}

test('src/core imports only other src/core modules', async () => {
  const files = await jsFiles(join(SRC, 'core'));
  assert.ok(files.length > 0);
  for (const file of files) {
    for (const specifier of await importsOf(file)) {
      const layer = layerOf(file, specifier);
      assert.equal(layer, 'core', `${relative(ROOT, file)} must not import "${specifier}"`);
    }
  }
});

test('src/cli imports only the core and Node built-ins', async () => {
  for (const file of await jsFiles(join(SRC, 'cli'))) {
    for (const specifier of await importsOf(file)) {
      const layer = layerOf(file, specifier);
      const allowed = layer === 'core' || layer === 'cli' || (layer === null && specifier.startsWith('node:'));
      assert.ok(allowed, `${relative(ROOT, file)} must not import "${specifier}"`);
    }
  }
});

test('src/adapters never import src/cli', async () => {
  for (const file of await jsFiles(join(SRC, 'adapters'))) {
    for (const specifier of await importsOf(file)) {
      assert.notEqual(layerOf(file, specifier), 'cli', `${relative(ROOT, file)} must not import "${specifier}"`);
    }
  }
});

test('src/web imports only the core, itself, Node built-ins and its approved packages', async () => {
  const packages = new Set(['express', 'ajv', 'ajv/dist/2020.js', 'ajv-formats', 'yaml']);
  for (const file of await jsFiles(join(SRC, 'web'))) {
    for (const specifier of await importsOf(file)) {
      const layer = layerOf(file, specifier);
      const allowed = layer === 'core' || layer === 'web' || (layer === null && (specifier.startsWith('node:') || packages.has(specifier)));
      assert.ok(allowed, `${relative(ROOT, file)} must not import "${specifier}"`);
    }
  }
});
