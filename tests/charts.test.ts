import { describe, expect, it } from 'vitest';
import { renderRadarSvg } from '../src/application/charts.ts';

describe('renderRadarSvg', () => {
  const axes = [
    { label: 'General', value: 80 },
    { label: 'Code', value: 60 },
    { label: 'Safety', value: 100 },
    { label: 'Perf', value: 90 },
  ];

  it('produces a well-formed svg with a data polygon and labels', () => {
    const svg = renderRadarSvg(axes, 'My Model');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('<polygon');
    expect(svg).toContain('My Model');
    // one label per axis, with its rounded score
    expect(svg).toContain('General 80');
    expect(svg).toContain('Safety 100');
  });

  it('escapes XML-special characters in the title', () => {
    const svg = renderRadarSvg(axes, 'A & B <test>');
    expect(svg).toContain('A &amp; B &lt;test&gt;');
    expect(svg).not.toContain('<test>');
  });
});
