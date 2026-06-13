import { describe, expect, it } from 'vitest';
import { runCodeTests } from '../src/shared/code-sandbox.ts';

describe('runCodeTests', () => {
  it('passes a correct implementation against all assertions', () => {
    const src = 'function add(a,b){ return a+b; }';
    const out = runCodeTests(src, 'add', ['add(2,3) === 5', 'add(-1,1) === 0']);
    expect(out.passed).toBe(true);
    expect(out.passedCount).toBe(2);
  });

  it('fails a wrong implementation', () => {
    const src = 'function add(a,b){ return a-b; }';
    const out = runCodeTests(src, 'add', ['add(2,3) === 5']);
    expect(out.passed).toBe(false);
    expect(out.passedCount).toBe(0);
  });

  it('captures runtime errors without throwing', () => {
    const src = 'function boom(){ throw new Error("nope"); }';
    const out = runCodeTests(src, 'boom', ['boom() === 1']);
    expect(out.passed).toBe(false);
    expect(out.error).toBeDefined();
  });

  it('cannot reach Node globals', () => {
    const src = 'function leak(){ return typeof process; }';
    const out = runCodeTests(src, 'leak', ["leak() === 'undefined'"]);
    expect(out.passed).toBe(true);
  });
});
