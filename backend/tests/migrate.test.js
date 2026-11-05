const fs = require('fs');
const os = require('os');
const path = require('path');
const { listMigrations, checksum } = require('../db/migrate');

describe('Migration runner (pure logic, no database needed)', () => {
  test('lists the real migrations in version order and ignores rollback files', () => {
    const migrations = listMigrations();
    const files = migrations.map((m) => m.file);
    expect(files[0]).toEqual('001_baseline.sql');
    expect(files).toContain('002_add_payment_method.sql');
    expect(files.some((f) => f.endsWith('.down.sql'))).toBe(false);
    const versions = migrations.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  test('checksum is stable across Windows (CRLF) and Linux (LF) line endings', () => {
    expect(checksum('SELECT 1;\nSELECT 2;\n')).toEqual(checksum('SELECT 1;\r\nSELECT 2;\r\n'));
  });

  test('checksum changes when the SQL changes', () => {
    expect(checksum('SELECT 1;')).not.toEqual(checksum('SELECT 2;'));
  });

  test('rejects two migrations that share a version number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    fs.writeFileSync(path.join(dir, '001_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(dir, '001_second.sql'), 'SELECT 2;');
    expect(() => listMigrations(dir)).toThrow(/Duplicate migration version 1/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
