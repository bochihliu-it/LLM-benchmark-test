# ADR 0003 — 以 TMMLU+ 強化繁中（zh-tw）檢測

- 狀態：Accepted
- 日期：2026-06

## 背景

zh-tw 維度原本只有自建的「企業情境」繁中題（郵件/RAG/在地業務）。為了更有公信力地衡量繁中**學科廣度**，導入公開、學界認可的 [TMMLU+](https://huggingface.co/datasets/ikala/tmmluplus)（iKala，MIT 授權，66 科目 / 22,690 題，四選一）。

## 決策

1. **並存而非取代**：zh-tw 同時載入兩個來源——`enterprise.json`（在地業務語境）與 `tmmluplus.json`（學科廣度）。`DATASET_FILES['zh-tw']` 改為陣列，`DatasetLoader` 串接兩者的 cases，version/checksum 反映全部來源。
2. **維持 0-shot 生成式評分**：沿用現有 `evaluateMultipleChoice`（要模型輸出選項字母 → 解析 → exact-match），走 LiteLLM/OpenAI 相容 API。**不**採 TMMLU+ 官方的 loglikelihood／5-shot，因為那需要 logprobs、且不是下游應用實際走的路徑。
3. **分類別子分數**：`MultipleChoiceCase` 新增 optional `category`（STEM/Humanities/Social Sciences/Other）與 `subject`；`mcq.ts` 額外輸出各類別正確率（`stemPct`/`humanitiesPct`/`socialSciPct`/`otherPct`）。
4. **離線、可重現的資料落地**：以一次性腳本 `scripts/ingest-tmmluplus.ts`（`pnpm ingest:tmmluplus`）在可連 HuggingFace 的環境抓取、**分層抽樣 ~200 題**（四類均分、固定 seed），輸出 commit 進 repo 的 JSON；評測時零外部相依。
5. **Bootstrap 佔位**：repo 先放一份明確標示的 `tmmluplus.json` 佔位樣本（非官方資料），讓管線與測試即刻可跑；使用者跑 ingest 腳本即以真實 ~200 題覆蓋。

## 理由與後果

- **可比性 caveat**：0-shot 生成式分數**不可**與官方 TMMLU+ 5-shot loglikelihood 排行榜直接比較；本專案視之為「內部相對指標」，已於 README／scoring-rubric 標注。
- **網路限制**：本評測沙箱預設未將 huggingface.co 列入 egress allowlist，故無法在此環境直接抓資料；ingest 腳本在被擋時會給出明確訊息，並支援 `--from <localDir>` 讀取本地快照。
- **授權**：TMMLU+ 為 MIT，符合本專案「授權允許商用」範圍；資料檔保留 source/license/citation 與抽樣 manifest 以利追溯。
- **零改動的維度執行**：runner 不變，符合 ADR 0002 的統一介面精神——導入新題庫只是換資料與加 optional 欄位。
