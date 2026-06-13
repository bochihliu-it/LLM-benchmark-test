import { describe, expect, it } from 'vitest';
import { extractChoiceLetter, extractCodeBlock, tryParseJson } from '../src/shared/parse.ts';

describe('extractChoiceLetter', () => {
  it('prefers an explicit answer marker', () => {
    expect(extractChoiceLetter('The answer is C.', ['A', 'B', 'C', 'D'])).toBe('C');
    expect(extractChoiceLetter('Answer: B', ['A', 'B', 'C'])).toBe('B');
  });
  it('falls back to the first valid standalone letter', () => {
    expect(extractChoiceLetter('I think B fits best', ['A', 'B', 'C'])).toBe('B');
  });
  it('returns null when no valid key is present', () => {
    expect(extractChoiceLetter('none of these', ['A', 'B'])).toBeNull();
  });
});

describe('extractCodeBlock', () => {
  it('extracts the body of a fenced block', () => {
    const text = 'Here:\n```javascript\nfunction f(){return 1;}\n```\nDone';
    expect(extractCodeBlock(text)).toBe('function f(){return 1;}');
  });
  it('returns the whole text when unfenced', () => {
    expect(extractCodeBlock('function g(){}')).toBe('function g(){}');
  });
});

describe('tryParseJson', () => {
  it('parses valid json and returns null for invalid', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson('{bad}')).toBeNull();
  });
});
