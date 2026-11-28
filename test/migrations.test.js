// Offline tests for the migration runner's pure parts (no database).
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { checksum, loadMigrations, pendingMigrations } from '../src/adapters/postgres/migrations.js';

async function withDir(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    return await fn(pathToFileURL(`${dir}/`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('checksum ignores CRLF versus LF line endings', () => {
  assert.equal(checksum('a;\r\nb;\r\n'), checksum('a;\nb;\n'));
  assert.notEqual(checksum('a;'), checksum('b;'));
});

test('loadMigrations sorts files by version and reads their checksums', async () => {
  await withDir({ '0002_second.sql': 'B;', '0001_first.sql': 'A;', 'notes.txt': 'ignored' }, async (url) => {
    const migrations = await loadMigrations(url);
    assert.deepEqual(migrations.map((m) => [m.version, m.name]), [['0001', 'first'], ['0002', 'second']]);
    assert.equal(migrations[0].checksum, checksum('A;'));
  });
});

test('loadMigrations rejects badly named and duplicate files', async () => {
  await withDir({ '1_bad.sql': 'x' }, (url) => assert.rejects(loadMigrations(url), /Invalid migration file name/));
  await withDir({ '0001_a.sql': 'x', '0001_b.sql': 'y' }, (url) => assert.rejects(loadMigrations(url), /Duplicate migration version 0001/));
});

test('pendingMigrations returns unapplied files and refuses changed or missing ones', () => {
  const files = [
    { version: '0001', file: '0001_a.sql', checksum: 'c1' },
    { version: '0002', file: '0002_b.sql', checksum: 'c2' },
  ];
  assert.deepEqual(pendingMigrations(files, [{ version: '0001', checksum: 'c1' }]).map((m) => m.version), ['0002']);
  assert.throws(() => pendingMigrations(files, [{ version: '0001', checksum: 'other' }]), /was changed after it was applied/);
  assert.throws(() => pendingMigrations(files, [{ version: '0009', checksum: 'c9' }]), /file is missing/);
});
