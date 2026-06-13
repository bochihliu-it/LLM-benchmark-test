# AI 服務評測體系（AI Benchmark）

針對 **非中國系開源大型語言模型** 建立一套企業內部的標準化評測體系，作為在 **有限的 HPE PCAI Server 資源** 上，決定「應該提供哪些模型服務」的提案與評估依據。

模型服務統一透過 **LiteLLM** 作為閘道（Gateway），評測與下游應用（OpenWebUI、實驗/研究專案）走 **完全相同的 OpenAI 相容 API**，確保「評測時的行為」與「上線後的行為」一致。

> 本 repo 已是一個**可執行的 MVP**：`pnpm benchmark:sample` 會以離線 mock 供應商，把 8 個評測維度在單一管線中**一起跑完**，產出標準化的結果 JSON、報告與排行榜。把設定檔的 `provider` 從 `mock` 改成 `litellm`，同一條管線即可對真實模型評測。

---

## 核心設計：所有維度「一起」評測

這是本專案要回答的關鍵問題——**不同性質的評測維度（客觀選擇題、LLM 裁判、效能負載）能否在同一套流程中一起進行？** 答案是結構性的「可以」：

```
                       ┌─────────────────────────────────────────┐
   設定檔 (config)  ──▶ │            Orchestrator                  │
   - 模型清單          │  for each model:                         │
   - 啟用的維度        │    for each enabled dimension:           │
   - 權重 / 門檻       │      runner.run(dataset, ctx) ───────────┼──▶ DimensionResult
   - 裁判模型          │    aggregate(...) + evaluateGates(...)    │       (objective / judge /
                       └─────────────────────────────────────────┘        performance)
                                        │
                       ┌────────────────┴───────────────┐
                       ▼                                 ▼
              results/*.json (真實來源)          reports/*.md + leaderboard.md
```

每個維度都實作**同一個 `DimensionRunner` 介面**，因此 orchestrator 不需要知道維度內部是用 exact-match、裁判打分、還是延遲量測——它一視同仁地呼叫、收集、加權。**新增一個維度 = 註冊一個 runner**，其餘流程完全不變。

| #   | 維度 (DimensionId) | 評測方法 | 範例基準 | 產出關鍵指標 |
| --- | ------------------ | -------- | -------- | ------------ |
| 1   | `general`          | objective（選擇題 exact-match） | MMLU-style | accuracyPct |
| 2   | `reasoning`        | objective（數值答案） | GSM8K-style | accuracyPct |
| 3   | `code`            | objective（沙箱跑單元測試 pass@k） | HumanEval-style | passAt1Pct |
| 4   | `zh-tw`           | objective（繁中選擇題） | TMMLU+-style | accuracyPct |
| 5   | `rag`             | **judge**（依檢索內容打 faithfulness） | Ragas-style | faithfulnessPct |
| 6   | `tool-use`        | objective（function call JSON 結構驗證） | BFCL-style | exactCallPct |
| 7   | `safety`          | objective（紅隊拒答偵測） | red-team | refusalRate |
| 8   | `performance`     | **performance**（TTFT/TPOT/吞吐/錯誤率） | 負載量測 | p95TtftMs, tokensPerSec |

---

## 三層混合驗證機制

對應提案 2.3 的三層評測，本系統實作如下：

1. **客觀題自動評分** — 選擇題 / 數值 / 程式碼，直接比對（exact-match、數值容差、沙箱 pass@k）。完全可重現。
2. **LLM-as-a-Judge** — 開放式生成（目前用於 RAG faithfulness）由一個**固定且記錄版本**的裁判模型依 rubric 打分。裁判模型與版本寫進每份結果的 `environment`，確保跨次可比。
3. **人工抽樣複核** — 每輪依 `humanReviewSampleRate`（預設 10%）以**固定種子**抽樣，產生 `Human review queue` 待辦清單供領域人員校正裁判偏差。

此外，**品質門檻（Quality Gates）** 是獨立於加權總分的「上線最低標準」。模型可能總分很高，卻因為某一項門檻未過而**不建議上線**（見排行榜 `Gates` 欄）。

---

## 綜合評分與決策

各維度先正規化到 0–100，再依**決策矩陣群組權重**加權：

| 群組群 (group)        | 預設權重 | 涵蓋維度 |
| --------------------- | -------- | -------- |
| `capability`          | 40%      | general, reasoning, code, zh-tw |
| `application`         | 25%      | rag, tool-use |
| `reliability-safety`  | 15%      | safety |
| `performance-cost`    | 20%      | performance |

最終排行榜以**綜合分數**排序，並附 **`效益/GPU` = 綜合分數 ÷ VRAM(GB)**，作為 PCAI 有限資源下「同樣能上線時優先選誰」的取捨依據。

---

## 快速開始

### 環境需求

- Node.js 22+
- pnpm 10+

### 安裝與驗證

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

### 執行範例評測（離線 mock，零基礎設施）

```bash
pnpm benchmark:sample        # 單一模型，8 維度一起跑，產出 result + report
pnpm benchmark:suite         # 5 個模型，產出可比較的排行榜
pnpm benchmark:validate      # 靜態檢查設定檔與資料集（不呼叫模型）
pnpm benchmark:list          # 列出可用維度、評測方法與資料集
pnpm report                  # 從 results/ 重新生成 reports/leaderboard.md + .csv
```

CLI 子指令：

```bash
benchmark run      --config <path> [overrides] [logging]
benchmark validate --config <path>      # pre-flight：資料集存在、kind 正確、gate 參照合法
benchmark list                          # 維度 / 方法 / 資料集一覽
benchmark report   [--results <dir>] [--out <dir>]
```

`run` 的覆寫旗標（不需改 JSON 即可彈性調整單次評測）：

```bash
--dimensions a,b,c    只跑指定維度
--models id1,id2      只跑指定模型 id
--seed <s>            覆寫可重現性種子
--concurrency <n>     覆寫每維度並發數
--go-live <n>         覆寫上線綜合分數門檻
--reports <dir>       報告輸出目錄（預設 reports）
--results <dir>       結果輸出目錄（覆寫 config.resultsDir）
--datasets <dir>      資料集目錄（覆寫 config.datasetsDir）
--no-report           跳過報告 / 排行榜輸出
```

### 紀錄與 Log 機制

每次 `run` 預設會在 `logs/run__<name>__<timestamp>.log` 留下一份**帶時間戳、可追溯的執行紀錄**（維度進度、各模型綜合分數與決策、產出檔路徑）。控制旗標：

```bash
--log <level>        console 等級：debug|info|warn|error（預設 info）
--log-file <path>    指定 log 檔路徑（預設 logs/run__<name>__<stamp>.log）
--no-log-file        不寫 log 檔（僅輸出到 console）
```

> Log 檔（`logs/`）為 git-ignored 的執行紀錄；結構化的「真實來源」仍是 `results/*.json`。兩者互補：JSON 供比較與重生報表，log 供追溯單次執行過程。

執行後：
- `results/*.json` — 每次 run 的完整、版本化結果（真實來源）。
- `reports/report__*.md` — 單一模型報告（決策建議、維度雷達圖、維度分數、群組加權、門檻、人工複核清單）。
- `reports/radar__*.svg` — 每個模型的維度雷達圖（GitHub 可直接渲染）。
- `reports/leaderboard.md` — 跨模型排行榜（含決策矩陣、`效益/GPU`、門檻狀態）。
- `reports/leaderboard.csv` — 排行榜 CSV，供 BI 工具匯入。

### 決策建議與品質門檻

每個模型會得到一個治理建議：**🟢 上線 Go-live**（綜合分數 ≥ `goLiveThreshold` 且通過所有 blocking 門檻）、**🟡 觀察 Watch**（通過 blocking 門檻但分數偏低，或有 warning 門檻未過）、**🔴 淘汰 Reject**（任一 blocking 門檻未過）。門檻可設 `severity`：`blocking`（阻擋上線）或 `warning`（僅提示、不阻擋）。決策矩陣會列出每個模型的建議與理由。

> **安全（safety）採雙重計分**：既計入加權總分（`reliability-safety` 群組 15%），也作為 blocking 門檻。治理上希望安全性差的模型「排名被扣分」且「直接被擋下」。

### 並發（concurrency）

設定檔的 `concurrency`（預設 4）控制每個維度同時在途的請求數，加速真實 LiteLLM 評測（對齊 DoD「< 1 個工作天」）。`performance` 維度刻意維持單執行緒以取得乾淨的延遲數據；真正的並發/吞吐壓測交給 `perf/` 的 k6 / vllm-bench。

### 對真實 LiteLLM 端點評測

1. 部署模型到 PCAI（vLLM）並掛上 LiteLLM。
2. 複製 `pipeline/configs/litellm-model.example.json`，填入 `litellm.baseUrl` 與要評測的 `models[].id`。
3. 提供金鑰（**只從環境變數讀取，永不寫進設定檔**）：
   ```bash
   export LITELLM_API_KEY=sk-...
   pnpm benchmark run --config pipeline/configs/my-litellm-run.json
   ```

評測呼叫預設以 streaming 進行，以誠實量測 time-to-first-token。

---

## 設定檔（pipeline/configs/）

| 檔案 | 用途 |
| ---- | ---- |
| `sample-model.json`          | 單一 mock 模型、8 維度、含上線門檻——快速 demo（happy path）。 |
| `sample-suite.json`          | 5 個 mock 模型——產生混合通過/未過門檻的排行榜。 |
| `litellm-model.example.json` | 對真實 LiteLLM 閘道評測的範本。 |

設定檔以 `zod` 嚴格驗證（見 `src/domain/config.ts`），缺漏欄位會給出明確錯誤；權重、群組對應、門檻、抽樣率皆可調。

---

## 專案結構

```text
.
├── src/
│   ├── cli/              # CLI 入口與參數解析
│   ├── application/      # orchestrator、judge、aggregator 組裝、report-writer
│   ├── domain/           # 純型別、scoring、gates、config schema（無 IO）
│   ├── infrastructure/   # LiteLLM client、mock client、dataset/result IO
│   └── shared/           # RNG（可重現）、解析、程式碼沙箱
├── pipeline/
│   ├── configs/          # 模型 / 任務設定
│   └── runners/          # 各維度評測執行器（共用 DimensionRunner 介面）
├── datasets/             # 自建測試集（general / reasoning / code / zh-tw / rag / tool-use / redteam / performance）
├── perf/                 # k6 / vllm-bench 負載測試腳本
├── docs/                 # 評分準則、SOP、ADR
├── results/              # 評測結果輸出（JSON，git-ignored）
├── reports/              # 報告、雷達圖、排行榜、CSV（git-ignored，可重生）
├── logs/                 # 每次 run 的執行紀錄（git-ignored）
└── tests/                # 單元 + 端到端（含可重現性）測試
```

---

## 如何新增一個評測維度

1. 在 `datasets/<dir>/` 放一個 `Dataset` JSON（見既有樣本）。
2. 在 `src/domain/types.ts` 為新的 case 種類加上型別（若需要）。
3. 在 `pipeline/runners/` 實作 `DimensionRunner`，回傳 `DimensionResult`。
4. 在 `pipeline/runners/registry.ts` 註冊，並在 `src/infrastructure/dataset-loader.ts` 的 `DATASET_FILES` 加上對應檔案。
5. 在設定檔的 `dimensions`、`groups`、（必要時）`gates` 納入。

orchestrator、加權、報表、排行榜**完全不需要改動**。

---

## 設計取捨與限制

- **可重現性優先**：所有隨機決策（mock 作答、人工抽樣）都由字串種子推導（`src/shared/rng.ts`），固定種子下重跑結果完全一致。
- **mock 供應商**讓整條管線在零基礎設施下可跑、可測；其作答正確率由 `competence`/`safetyRate` 參數驅動，僅供 demo 與 CI，不代表任何真實模型表現。
- **程式碼沙箱**（`src/shared/code-sandbox.ts`）僅用 `node:vm` + 逾時，足以評測小型自含函式，但**不是對抗式安全邊界**；正式評測不受信任模型時應改用容器 / worker 隔離。
- **效能維度**的 in-process 量測是 smoke 等級；真正的並發/吞吐壓測委派給 `perf/` 下的 k6 / vllm-bench。

詳見 `docs/adr/`。
