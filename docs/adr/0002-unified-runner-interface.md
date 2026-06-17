# ADR 0002 — 統一 Runner 介面讓異質維度一起評測

- 狀態：Accepted
- 日期：2026-06

## 背景

評測維度性質差異很大：選擇題是 exact-match、RAG 需要 LLM 裁判、效能是延遲/吞吐量測。最初的疑問是：這些維度能否在同一套流程中「一起」評測，而不是各跑各的腳本、各產各的格式？

## 決策

定義單一 `DimensionRunner` 介面：

```ts
interface DimensionRunner {
  readonly id: DimensionId;
  readonly method: EvaluationMethod;   // 'objective' | 'judge' | 'performance'
  run(dataset: Dataset, ctx: RunContext): Promise<DimensionResult>;
}
```

orchestrator 依設定檔啟用的維度，逐一呼叫 runner，收集 `DimensionResult[]`，再統一加權（`aggregate`）與評門檻（`evaluateGates`）。

## 理由

- **一致的輸出形狀**：不論內部方法為何，每個維度都回傳 `DimensionResult`（rawScore 0–100、cases、metrics、資料集版本/checksum），下游加權、報表、排行榜得以共用。
- **可組合**：一輪評測 = 一個模型 × 一組維度；要不要某維度只是設定檔開關。
- **低擴充成本**：新增維度 = 實作並註冊一個 runner，orchestrator/aggregator/報表完全不動（見 README「如何新增一個評測維度」）。

## 後果

- 維度共用的 `RunContext` 提供 client、judge、logger、群組對應、人工抽樣決策。
- `method` 欄位讓報表能標示每個維度是客觀、裁判還是量測得來，利於人工複核聚焦。
- 三層驗證（客觀 / 裁判 / 人工抽樣）自然落在此結構內：前兩層由 runner+judge 產生分數，第三層由 `RunContext.sampleForReview` 以固定種子抽樣標記。
