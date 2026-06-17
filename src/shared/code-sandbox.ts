/**
 * Minimal JavaScript sandbox for the code dimension. Model output is run in a
 * fresh V8 context with a wall-clock timeout and no access to Node globals
 * (no require, no process, no fs). This is adequate for evaluating small,
 * self-contained functions against assertions; it is NOT a security boundary
 * for adversarial code and should be replaced by a container/worker for
 * untrusted models in production.
 */
import { createContext, runInContext } from 'node:vm';

export interface CodeRunOutcome {
  passed: boolean;
  passedCount: number;
  total: number;
  error?: string;
}

export function runCodeTests(
  source: string,
  entrypoint: string,
  tests: string[],
  timeoutMs = 1000,
): CodeRunOutcome {
  const total = tests.length;
  const harness = `
    'use strict';
    ${source}
    const __assertions = ${JSON.stringify(tests)};
    let __passed = 0;
    const __errors = [];
    for (const __t of __assertions) {
      try {
        const __fn = new Function('${entrypoint}', 'return (' + __t + ');');
        if (__fn(typeof ${entrypoint} !== 'undefined' ? ${entrypoint} : undefined)) {
          __passed++;
        } else {
          __errors.push('assertion failed: ' + __t);
        }
      } catch (e) {
        __errors.push(String(e && e.message ? e.message : e));
      }
    }
    ({ passed: __passed, errors: __errors });
  `;

  const context = createContext(Object.create(null));
  try {
    const result = runInContext(harness, context, { timeout: timeoutMs }) as {
      passed: number;
      errors: string[];
    };
    return {
      passed: result.passed === total && total > 0,
      passedCount: result.passed,
      total,
      error: result.errors.length ? result.errors.slice(0, 2).join('; ') : undefined,
    };
  } catch (err) {
    return {
      passed: false,
      passedCount: 0,
      total,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
