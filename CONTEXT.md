# CONTEXT — 領域語言與決策語彙

本文件固定團隊在討論評測時使用的詞彙，避免口頭交接造成歧義。程式碼中的識別字（型別名、欄位名）一律對應此處定義。

## 核心名詞

| 詞彙 | 英文 / 識別字 | 定義 |
| ---- | ------------- | ---- |
| 評測一輪 | run | 一個受測模型在一組啟用維度上的單次完整評測，產出一份 `BenchmarkResult`。 |
| 維度 | dimension (`DimensionId`) | 一個能力面向，例如 `general`、`rag`、`performance`。每個維度有一個 runner 與一份資料集。 |
| 案例 | case (`TaskCase`) | 維度資料集中的一題。依 `kind` 區分（multiple-choice / numeric / code / judge / safety / tool-use / perf）。 |
| 評測方法 | method (`EvaluationMethod`) | 一個維度產生分數的方式：`objective`（自動比對）、`judge`（LLM 裁判）、`performance`（量測）。 |
| 裁判 | judge | 固定且記錄版本的模型，依 rubric 為開放式生成打分。版本寫進 `environment`。 |
| 群組 | group (`DimensionGroup`) | 決策矩陣的加權單位：`capability` / `application` / `reliability-safety` / `performance-cost`。 |
| 綜合分數 | overall | 各維度正規化（0–100）後依群組權重加總的單一分數。 |
| 品質門檻 | gate (`GateResult`) | 上線最低標準，獨立於綜合分數。任一門檻未過即「不建議上線」。 |
| 效益/GPU | efficiency | 綜合分數 ÷ VRAM(GB)，PCAI 有限資源下的取捨指標。 |
| 閘道 | gateway / LiteLLM | 統一的 OpenAI 相容 API 層；評測與下游應用走同一條路徑。 |

## 決策語彙

- **「上線」(go-live)**：綜合分數可接受 **且** 通過所有品質門檻。
- **「淘汰 / 觀察」**：綜合分數偏低，或關鍵門檻未過。
- **「可重現」(reproducible)**：固定 `seed`、資料集 `checksum`、裁判 `model@version` 後重跑，分數誤差 < 2%。
- **「資料集版本」**：每份 `Dataset` 帶 `version` 與內容 `checksum`（sha256 前 16 碼），寫進結果以利追溯。

## 不在範圍內（避免誤用詞彙）

- 不評測「訓練 / 微調」品質，只評「推理服務」。
- 不評測閉源商用 API（除非作為裁判或對照）。
- mock 供應商的分數**不是**任何真實模型的成績，只是讓管線可跑、可測的替身。
