/** Minimal leveled logger; structured enough for CI, quiet enough for a TTY. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const min = order[level];
  const emit =
    (lvl: LogLevel) =>
    (msg: string, meta?: unknown): void => {
      if (order[lvl] < min) return;
      const prefix = `[${lvl.toUpperCase()}]`;
      if (meta === undefined) console.error(prefix, msg);
      else console.error(prefix, msg, typeof meta === 'string' ? meta : JSON.stringify(meta));
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
