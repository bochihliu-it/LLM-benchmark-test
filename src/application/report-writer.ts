/**
 * Renders human-facing artifacts from result JSON: a per-run Markdown report
 * (with an SVG radar chart), a cross-model leaderboard, and a CSV export for BI.
 * Reports are derived, never authoritative — the JSON results are the source of
 * truth — so they can be regenerated at any time.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkResult, GateResult } from '../domain/types.ts';
import { efficiency } from '../domain/scoring.ts';
import { recommend } from '../domain/decision.ts';
import { renderRadarSvg, type RadarAxis } from './charts.ts';

const DIMENSION_LABELS: Record<string, string> = {
  general: '通用能力 General',
  reasoning: '推理 Reasoning',
  code: '程式碼 Code',
  'zh-tw': '繁中 zh-TW',
  rag: 'RAG 適配',
  'tool-use': '工具呼叫 Tool-use',
  safety: '可靠與安全 Safety',
  performance: '效能 Performance',
};

const SHORT_LABELS: Record<string, string> = {
  general: 'General',
  reasoning: 'Reason',
  code: 'Code',
  'zh-tw': 'zh-TW',
  rag: 'RAG',
  'tool-use': 'Tool',
  safety: 'Safety',
  performance: 'Perf',
};

const DIM_ORDER = [
  'general',
  'reasoning',
  'code',
  'zh-tw',
  'rag',
  'tool-use',
  'safety',
  'performance',
];

export class ReportWriter {
  constructor(
    private readonly dir: string,
    private readonly goLiveThreshold = 75,
  ) {}

  async writeRunReport(result: BenchmarkResult): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const safeModel = result.model.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const stamp = result.startedAt.replace(/[:.]/g, '-');

    // Write the radar chart as a standalone SVG the Markdown links to.
    const svgName = `radar__${safeModel}__${stamp}.svg`;
    const axes: RadarAxis[] = result.dimensions.map((d) => ({
      label: SHORT_LABELS[d.dimensionId] ?? d.dimensionId,
      value: d.rawScore,
    }));
    if (axes.length >= 3) {
      await writeFile(join(this.dir, svgName), renderRadarSvg(axes, result.model.label), 'utf8');
    }

    const md = renderRunReport(result, this.goLiveThreshold, axes.length >= 3 ? svgName : undefined);
    const file = join(this.dir, `report__${safeModel}__${stamp}.md`);
    await writeFile(file, md, 'utf8');
    return file;
  }

  async writeLeaderboard(results: BenchmarkResult[]): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const md = renderLeaderboard(results, this.goLiveThreshold);
    const file = join(this.dir, 'leaderboard.md');
    await writeFile(file, md, 'utf8');
    await writeFile(join(this.dir, 'leaderboard.csv'), renderLeaderboardCsv(results), 'utf8');
    return file;
  }
}

function gateLine(g: GateResult): string {
  const actual = Number.isNaN(g.actual) ? 'n/a' : String(g.actual);
  const sev = g.severity === 'warning' ? '⚠️ warning' : 'blocking';
  const status = Number.isNaN(g.actual)
    ? '⚪ N/A'
    : g.passed
      ? '✅ PASS'
      : g.severity === 'warning'
        ? '⚠️ WARN'
        : '❌ FAIL';
  return `| ${g.label} | ${g.comparator} ${g.threshold} | ${actual} | ${sev} | ${status} |`;
}

export function renderRunReport(
  result: BenchmarkResult,
  goLiveThreshold = 75,
  svgName?: string,
): string {
  const lines: string[] = [];
  const a = result.aggregate;
  const rec = recommend(a, goLiveThreshold);

  lines.push(`# 評測報告 — ${result.model.label}`);
  lines.push('');
  lines.push(`- **Model**: \`${result.model.id}\` (${result.model.provider})`);
  if (result.model.params) lines.push(`- **Params**: ${result.model.params}`);
  if (result.model.quantization) lines.push(`- **Quantization**: ${result.model.quantization}`);
  if (result.model.vramGb) lines.push(`- **VRAM**: ~${result.model.vramGb} GB`);
  lines.push(`- **Overall**: **${a.overall.toFixed(1)} / 100**`);
  lines.push(`- **Decision**: **${rec.label}** — ${rec.reason}`);
  lines.push(`- **Gates**: ${a.gatesPassed ? '✅ all blocking gates passed' : '❌ blocked'}`);
  lines.push(`- **Run**: ${result.startedAt} → ${result.finishedAt}`);
  lines.push(
    `- **Reproducibility**: seed=\`${result.environment.seed}\`, judge=\`${result.environment.judgeModel}@${result.environment.judgeVersion}\`, node=${result.environment.node}`,
  );
  lines.push('');

  if (svgName) {
    lines.push('## 維度雷達圖 Dimension radar');
    lines.push('');
    lines.push(`![${result.model.label} radar chart](./${svgName})`);
    lines.push('');
  }

  lines.push('## 維度分數 Dimension scores');
  lines.push('');
  lines.push('| 維度 | 方法 | 分數 /100 | 資料集 | 關鍵指標 |');
  lines.push('| --- | --- | ---: | --- | --- |');
  for (const d of result.dimensions) {
    const metrics = Object.entries(d.metrics)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(
      `| ${DIMENSION_LABELS[d.dimensionId] ?? d.dimensionId} | ${d.method} | ${d.rawScore.toFixed(
        1,
      )} | ${d.datasetVersion} (\`${d.datasetChecksum}\`) | ${metrics} |`,
    );
  }
  lines.push('');

  lines.push('## 群組加權 Group weighting');
  lines.push('');
  lines.push('| 群組 | 權重 | 分數 |');
  lines.push('| --- | ---: | ---: |');
  for (const [group, g] of Object.entries(a.groups)) {
    lines.push(`| ${group} | ${(g.weight * 100).toFixed(0)}% | ${g.score.toFixed(1)} |`);
  }
  lines.push('');

  if (a.gates.length) {
    lines.push('## 品質門檻 Quality gates');
    lines.push('');
    lines.push('| 門檻 | 條件 | 實測 | 類型 | 結果 |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const g of a.gates) lines.push(gateLine(g));
    lines.push('');
  }

  const sampled = result.dimensions.flatMap((d) =>
    d.cases.filter((c) => c.sampledForReview).map((c) => `${d.dimensionId}/${c.caseId}`),
  );
  lines.push('## 人工抽樣複核 Human review queue');
  lines.push('');
  lines.push(
    sampled.length
      ? `${sampled.length} cases drawn (seeded):\n\n` +
          sampled.map((s) => `- [ ] ${s}`).join('\n')
      : '_No cases sampled this run (sample rate may be 0)._',
  );
  lines.push('');

  return lines.join('\n') + '\n';
}

/** Keep only the most recent run per model id, so reruns supersede old scores. */
export function latestPerModel(results: BenchmarkResult[]): BenchmarkResult[] {
  const byId = new Map<string, BenchmarkResult>();
  for (const r of results) {
    const prev = byId.get(r.model.id);
    if (!prev || r.startedAt > prev.startedAt) byId.set(r.model.id, r);
  }
  return [...byId.values()];
}

interface LeaderRow {
  label: string;
  id: string;
  overall: number;
  gatesPassed: boolean;
  vram?: number;
  eff: number | null;
  perDim: Record<string, number>;
  decision: ReturnType<typeof recommend>;
}

function leaderRows(allResults: BenchmarkResult[], goLiveThreshold: number): LeaderRow[] {
  return latestPerModel(allResults)
    .map((r) => ({
      label: r.model.label,
      id: r.model.id,
      overall: r.aggregate.overall,
      gatesPassed: r.aggregate.gatesPassed,
      vram: r.model.vramGb,
      eff: efficiency(r.aggregate.overall, r.model.vramGb),
      perDim: r.aggregate.perDimension,
      decision: recommend(r.aggregate, goLiveThreshold),
    }))
    .sort((a, b) => b.overall - a.overall);
}

export function renderLeaderboard(allResults: BenchmarkResult[], goLiveThreshold = 75): string {
  const rows = leaderRows(allResults, goLiveThreshold);
  const lines: string[] = [];
  lines.push('# 🏆 模型評測排行榜 Leaderboard');
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()} from ${rows.length} model(s)._`);
  lines.push('');
  lines.push(
    '> 排序依綜合分數；`效益/GPU` = 綜合分數 ÷ VRAM(GB)，作為 PCAI 有限資源下的取捨依據。',
  );
  lines.push('');

  const header = ['#', 'Model', 'Overall', 'Decision', 'Gates', 'VRAM(GB)', '效益/GPU', ...DIM_ORDER];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  rows.forEach((r, i) => {
    const dims = DIM_ORDER.map((d) => (r.perDim[d] !== undefined ? r.perDim[d]!.toFixed(0) : '–'));
    lines.push(
      `| ${i + 1} | ${r.label} | **${r.overall.toFixed(1)}** | ${decisionBadge(
        r.decision.decision,
      )} | ${r.gatesPassed ? '✅' : '❌'} | ${r.vram ?? '–'} | ${r.eff ?? '–'} | ${dims.join(
        ' | ',
      )} |`,
    );
  });
  lines.push('');

  // Decision matrix: explicit recommendation + rationale per model.
  lines.push('## 決策矩陣 Decision matrix');
  lines.push('');
  lines.push('| Model | Overall | 效益/GPU | 建議 Decision | 理由 Reason |');
  lines.push('| --- | ---: | ---: | --- | --- |');
  for (const r of rows) {
    lines.push(
      `| ${r.label} | ${r.overall.toFixed(1)} | ${r.eff ?? '–'} | ${decisionBadge(
        r.decision.decision,
      )} ${r.decision.label} | ${r.decision.reason} |`,
    );
  }
  lines.push('');

  lines.push('## 圖例 Legend');
  lines.push('');
  lines.push(`- **Decision**: 🟢 上線（綜合 ≥ ${goLiveThreshold} 且通過所有 blocking 門檻）｜🟡 觀察｜🔴 淘汰（blocking 門檻未過）。`);
  lines.push('- **Gates**: ✅ 通過全部 blocking 門檻；❌ 至少一項 blocking 未達標。');
  lines.push('- 維度分數為 0–100；`–` 表示該維度未納入此次評測。');
  lines.push('');
  return lines.join('\n') + '\n';
}

function decisionBadge(d: 'go-live' | 'watch' | 'reject'): string {
  return d === 'go-live' ? '🟢' : d === 'watch' ? '🟡' : '🔴';
}

export function renderLeaderboardCsv(allResults: BenchmarkResult[], goLiveThreshold = 75): string {
  const rows = leaderRows(allResults, goLiveThreshold);
  const header = [
    'rank',
    'model_id',
    'model_label',
    'overall',
    'decision',
    'gates_passed',
    'vram_gb',
    'efficiency_per_gpu',
    ...DIM_ORDER,
  ];
  const out: string[] = [header.join(',')];
  rows.forEach((r, i) => {
    const dims = DIM_ORDER.map((d) => (r.perDim[d] !== undefined ? String(r.perDim[d]) : ''));
    const cells = [
      String(i + 1),
      csv(r.id),
      csv(r.label),
      String(r.overall),
      r.decision.decision,
      String(r.gatesPassed),
      r.vram !== undefined ? String(r.vram) : '',
      r.eff !== null ? String(r.eff) : '',
      ...dims,
    ];
    out.push(cells.join(','));
  });
  return out.join('\n') + '\n';
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
