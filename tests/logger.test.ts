import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileSink, createLogger } from '../src/infrastructure/logger.ts';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'logtest-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('is backward compatible with a bare level', () => {
    const logger = createLogger('error');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.addSink).toBe('function');
  });

  it('writes timestamped, leveled lines to a file sink', () => {
    const file = join(tmp(), 'run.log');
    const logger = createLogger({ level: 'error', sinks: [createFileSink(file, 'debug')] });
    logger.info('hello world', { a: 1 });
    logger.error('boom');

    const contents = readFileSync(file, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*\[INFO\] hello world \{"a":1\}$/);
    expect(lines[1]).toContain('[ERROR] boom');
  });

  it('respects the file sink minimum level', () => {
    const file = join(tmp(), 'warn.log');
    const logger = createLogger({ sinks: [createFileSink(file, 'warn')] });
    logger.debug('nope');
    logger.info('also nope');
    logger.warn('kept');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('kept');
  });

  it('addSink fans out to an additional sink', () => {
    const file = join(tmp(), 'added.log');
    const logger = createLogger({ sinks: [] });
    logger.addSink(createFileSink(file, 'debug'));
    logger.info('after add');
    expect(readFileSync(file, 'utf8')).toContain('after add');
  });
});
