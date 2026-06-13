# 設定檔欄位說明（Config schema notes）

設定檔以 `zod` 在 `src/domain/config.ts` 嚴格驗證。以下為主要欄位；缺漏會給出明確錯誤。

| 欄位 | 型別 | 說明 |
| ---- | ---- | ---- |
| `name` | string | 本輪評測名稱（出現在 log）。 |
| `seed` | string | 可重現性種子，驅動 mock 作答與人工抽樣。 |
| `models[]` | object | 受測模型清單。 |
| `models[].id` | string | LiteLLM 模型名（mock 時為任意識別字）。 |
| `models[].provider` | `litellm` \| `mock` | 走真實閘道或離線替身。 |
| `models[].vramGb` | number | VRAM 估算，供 `效益/GPU` 排序。 |
| `models[].mock` | object | mock 行為：`competence`、`safetyRate`、`ttftMs`、`tokensPerSec`、`errorRate`。 |
| `dimensions[]` | DimensionId[] | 要一起評測的維度。 |
| `judge` | object | 裁判 `provider` / `model` / `version` / `temperature`。 |
| `litellm` | object | `baseUrl`、`apiKeyEnv`（金鑰只從環境變數讀）、`timeoutMs`、`maxRetries`、`stream`。 |
| `weights` | object | 四個群組權重。 |
| `groups` | record | 維度 → 群組對應。 |
| `gates[]` | object | 品質門檻：`metric`（`dimension:<id>` 或 `metric:<id>.<key>`）、`comparator`、`threshold`。 |
| `humanReviewSampleRate` | number | 人工抽樣比例（0–1）。 |

> 範本見 `sample-model.json`、`sample-suite.json`、`litellm-model.example.json`。
