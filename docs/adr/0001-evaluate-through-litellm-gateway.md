# ADR 0001 — 一律透過 LiteLLM 閘道評測

- 狀態：Accepted
- 日期：2026-06

## 背景

模型服務統一以 LiteLLM 作為閘道，分發給 OpenWebUI 與其他應用。評測可以選擇直接打 vLLM，或走 LiteLLM。

## 決策

**評測一律走 LiteLLM 的 OpenAI 相容 API**，與下游應用完全相同的路徑。

## 理由

- 「評測時的行為」必須等於「下游應用實際取得的行為」，包含閘道層的逾時、重試、串流、模型路由與用量統計。
- 若繞過閘道直接打推理引擎，會量測到一個使用者永遠體驗不到的環境，導致延遲與穩定性數據失真。
- 以 OpenAI 相容介面為唯一抽象，讓「換模型」對評測管線而言只是換一個 `model` 名稱。

## 後果

- 客戶端（`src/infrastructure/litellm-client.ts`）以原生 `fetch` 實作，預設 streaming 以誠實量測 TTFT。
- 金鑰只從環境變數讀取，不進設定檔。
- 離線情境以 mock 供應商替身（同一 `ModelClient` 介面），讓 CI 與 demo 不需基礎設施即可跑完整流程。
