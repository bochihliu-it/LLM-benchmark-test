/**
 * Renders human-facing artifacts from result JSON: a per-run Markdown report and
 * a cross-model leaderboard. Reports are derived, never authoritative — the JSON
 * results are the source of truth — so they can be regenerated at any time.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkResult, GateResult } from '../domain/types.ts';
import { efficiency } from '../domain/scoring.ts';

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

export class ReportWriter {
  constructor(private readonly dir: string) {}

  async writeRunReport(result: BenchmarkResult): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const md = renderRunReport(result);
    const safeModel = result.model.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const stamp = result.startedAt.replace(/[:.]/g, '-');
    const file = join(this.dir, `report__${safeModel}__${stamp}.md`);
    await writeFile(file, md, 'utf8');
    return file;
  }

  async writeLeaderboard(results: BenchmarkResult[]): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const md = renderLeaderboard(results);
    const file = join(this.dir, 'leaderboard.md');
    await writeFile(file, md, 'utf8');
    return file;
  }
}

function gateLine(g: GateResult): string {
  const actual = Number.isNaN(g.actual) ? 'n/a' : String(g.actual);
  const status = Number.isNaN(g.actual) ? '⚪ N/A' : g.passed ? '✅ PASS' : '❌ FAIL';
  return `| ${g.label} | ${g.comparator} ${g.threshold} | ${actual} | ${status} |`;
}

export function renderRunReport(result: BenchmarkResult): string {
  const lines: string[] = [];
  const a = result.aggregate;
  lines.push(`# 評測報告 — ${result.model.label}`);
  lines.push('');
  lines.push(`- **Model**: \`${result.model.id}\` (${result.model.provider})`);
  if (result.model.params) lines.push(`- **Params**: ${result.model.params}`);
  if (result.model.quantization) lines.push(`- **Quantization**: ${result.model.quantization}`);
  if (result.model.vramGb) lines.push(`- **VRAM**: ~${result.model.vramGb} GB`);
  lines.push(`- **Overall**: **${a.overall.toFixed(1)} / 100**`);
  lines.push(`- **Gates**: ${a.gatesPassed ? '✅ all passed' : '❌ blocked'}`);
  lines.push(`- **Run**: ${result.startedAt} → ${result.finishedAt}`);
  lines.push(
    `- **Reproducibility**: seed=\`${result.environment.seed}\`, judge=\`${result.environment.judgeModel}@${result.environment.judgeVersion}\`, node=${result.environment.node}`,
  );
  lines.push('');

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
    lines.push('| 門檻 | 條件 | 實測 | 結果 |');
    lines.push('| --- | --- | ---: | --- |');
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
      ? `${sampled.length} cases drawn (${(result.environment.seed && 'seeded') || ''}):\n\n` +
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

export function renderLeaderboard(allResults: BenchmarkResult[]): string {
  const results = latestPerModel(allResults);
  const rows = results
    .map((r) => {
      const eff = efficiency(r.aggregate.overall, r.model.vramGb);
      return {
        label: r.model.label,
        id: r.model.id,
        overall: r.aggregate.overall,
        gates: r.aggregate.gatesPassed,
        vram: r.model.vramGb,
        eff,
        perDim: r.aggregate.perDimension,
      };
    })
    .sort((a, b) => b.overall - a.overall);

  const dimOrder = ['general', 'reasoning', 'code', 'zh-tw', 'rag', 'tool-use', 'safety', 'performance'];
  const lines: string[] = [];
  lines.push('# 🏆 模型評測排行榜 Leaderboard');
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()} from ${results.length} run(s)._`);
  lines.push('');
  lines.push(
    '> 排序依綜合分數；`效益/GPU` = 綜合分數 ÷ VRAM(GB)，作為 PCAI 有限資源下的取捨依據。',
  );
  lines.push('');

  const header = ['#', 'Model', 'Overall', 'Gates', 'VRAM(GB)', '效益/GPU', ...dimOrder];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  rows.forEach((r, i) => {
    const dims = dimOrder.map((d) => (r.perDim[d] !== undefined ? r.perDim[d]!.toFixed(0) : '–'));
    lines.push(
      `| ${i + 1} | ${r.label} | **${r.overall.toFixed(1)}** | ${
        r.gates ? '✅' : '❌'
      } | ${r.vram ?? '–'} | ${r.eff ?? '–'} | ${dims.join(' | ')} |`,
    );
  });
  lines.push('');
  lines.push('## 圖例 Legend');
  lines.push('');
  lines.push('- **Gates**: ✅ 通過全部上線門檻；❌ 至少一項未達標（即使綜合分數高也不建議上線）。');
  lines.push('- 維度分數為 0–100；`–` 表示該維度未納入此次評測。');
  lines.push('');
  return lines.join('\n') + '\n';
}
