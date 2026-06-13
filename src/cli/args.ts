/** Tiny zero-dependency argv parser: `cmd --key value --flag`. */
export interface ParsedArgs {
  command: string | undefined;
  options: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(key);
    } else {
      options[key] = next;
      i++;
    }
  }

  return { command, options, flags };
}
