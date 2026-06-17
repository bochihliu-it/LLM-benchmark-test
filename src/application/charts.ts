/**
 * Dependency-free SVG chart rendering for reports. GitHub renders linked .svg
 * images in Markdown, so we write a standalone .svg next to each report and
 * reference it — no client-side JS, no build step, no runtime deps.
 */

export interface RadarAxis {
  label: string;
  /** Score in [0, 100]. */
  value: number;
}

/**
 * Render a radar (spider) chart of dimension scores. One axis per dimension,
 * gridlines at 25/50/75/100, and a filled polygon of the model's scores.
 */
export function renderRadarSvg(axes: RadarAxis[], title: string): string {
  const size = 420;
  const cx = size / 2;
  const cy = size / 2 + 10;
  const radius = 150;
  const n = Math.max(axes.length, 3);

  const angleFor = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, frac: number): [number, number] => {
    const a = angleFor(i);
    return [cx + radius * frac * Math.cos(a), cy + radius * frac * Math.sin(a)];
  };

  const rings = [0.25, 0.5, 0.75, 1].map((frac) => {
    const pts = axes
      .map((_, i) => point(i, frac))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#d0d7de" stroke-width="1" />`;
  });

  const spokes = axes
    .map((_, i) => {
      const [x, y] = point(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#d0d7de" stroke-width="1" />`;
    })
    .join('\n  ');

  const dataPts = axes
    .map((ax, i) => point(i, clamp01(ax.value / 100)))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  const labels = axes
    .map((ax, i) => {
      const [x, y] = point(i, 1.16);
      const anchor = x < cx - 5 ? 'end' : x > cx + 5 ? 'start' : 'middle';
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(
        1,
      )}" font-size="12" fill="#57606a" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(
        ax.label,
      )} ${Math.round(ax.value)}</text>`;
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeXml(
    title,
  )}">
  <rect width="${size}" height="${size}" fill="#ffffff" />
  <text x="${cx}" y="24" font-size="15" font-weight="600" fill="#24292f" text-anchor="middle">${escapeXml(
    title,
  )}</text>
  ${rings.join('\n  ')}
  ${spokes}
  <polygon points="${dataPts}" fill="#0969da" fill-opacity="0.25" stroke="#0969da" stroke-width="2" />
  ${labels}
</svg>
`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
