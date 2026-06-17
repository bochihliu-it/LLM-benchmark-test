/**
 * Leveled logger with pluggable sinks. By default it writes human-readable lines
 * to the console (stderr); a file sink can be attached so every run leaves a
 * durable, timestamped record under logs/ for later auditing.
 *
 * Kept deliberately small and synchronous: a benchmark CLI is low-volume, and
 * sync appends keep log ordering trivially correct without a flush dance.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  meta?: unknown;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  /** Attach another sink (e.g. a file) after construction. */
  addSink(sink: LogSink): void;
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return '';
  return ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
}

/** Console sink (stderr), filtered by its own minimum level. */
export function createConsoleSink(level: LogLevel = 'info'): LogSink {
  const min = order[level];
  return {
    write(r) {
      if (order[r.level] < min) return;
      console.error(`[${r.level.toUpperCase()}]`, r.msg + formatMeta(r.meta));
    },
  };
}

/**
 * File sink: appends `ISO_TIMESTAMP [LEVEL] message meta` lines. Captures from
 * `level` down (default debug), so the file is a fuller record than the console.
 */
export function createFileSink(path: string, level: LogLevel = 'debug'): LogSink {
  mkdirSync(dirname(path), { recursive: true });
  const min = order[level];
  return {
    write(r) {
      if (order[r.level] < min) return;
      appendFileSync(path, `${r.ts} [${r.level.toUpperCase()}] ${r.msg}${formatMeta(r.meta)}\n`);
    },
  };
}

export interface LoggerOptions {
  level?: LogLevel;
  sinks?: LogSink[];
}

/**
 * Create a logger. Accepts a bare level (back-compatible: `createLogger('info')`)
 * or an options object with explicit sinks.
 */
export function createLogger(levelOrOptions: LogLevel | LoggerOptions = 'info'): Logger {
  const opts: LoggerOptions =
    typeof levelOrOptions === 'string' ? { level: levelOrOptions } : levelOrOptions;
  const sinks: LogSink[] = opts.sinks ?? [createConsoleSink(opts.level ?? 'info')];

  const emit =
    (level: LogLevel) =>
    (msg: string, meta?: unknown): void => {
      const record: LogRecord = { ts: new Date().toISOString(), level, msg, meta };
      for (const sink of sinks) sink.write(record);
    };

  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    addSink(sink: LogSink): void {
      sinks.push(sink);
    },
  };
}
