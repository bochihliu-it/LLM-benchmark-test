# SOP — 一輪模型評測標準作業流程

目標：新成員不依賴口頭交接，即可獨立完成一輪評測，並在固定時間內（< 1 個工作天）產出標準化報告。

## 前置

- [ ] Node.js 22+、pnpm 10+ 已安裝。
- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test` 全綠。
- [ ] 待測模型已部署於 PCAI（vLLM）並掛上 LiteLLM，可由評測機以 OpenAI 相容 API 連線。
- [ ] 取得 LiteLLM 金鑰，設為環境變數 `LITELLM_API_KEY`（**不要寫進設定檔**）。

## 步驟

1. **盤點與初篩**
   - 確認模型授權允許商用、為非中國系開源。
   - 估算 VRAM 需求，填入設定檔 `models[].vramGb`（供 `效益/GPU` 排序）。

2. **準備設定檔**
   - 複製 `pipeline/configs/litellm-model.example.json`。
   - 填入 `litellm.baseUrl`、`models[].id`（LiteLLM 模型名）、`judge.model` 與 `judge.version`。
   - 確認 `dimensions`、`weights`、`groups`、`gates` 符合本輪需求。
   - 固定 `seed`（預設 `ai-benchmark-2026`），確保可重現。

3. **執行評測**
   ```bash
   pnpm benchmark run --config pipeline/configs/<your-run>.json
   # 可用旗標彈性調整單次評測，毋須改 JSON，例如只跑部分維度 / 模型：
   pnpm benchmark run --config <run>.json --dimensions general,zh-tw,rag --models <id>
   ```
   - 8 個維度會在同一條管線一起跑完。
   - 產出 `results/<model>__<timestamp>.json`、`reports/report__<model>__<timestamp>.md`（含雷達圖）。
   - 每次執行另存一份可追溯紀錄於 `logs/run__<name>__<timestamp>.log`（`--no-log-file` 可關閉）。

4. **效能負載測試（維度外的深度量測）**
   - in-process 的 `performance` 維度只是 smoke 量測。
   - 針對候選模型，另以 `perf/` 下腳本做並發/吞吐壓測（見 `perf/README.md`）。

5. **人工抽樣複核**
   - 打開報告的「Human review queue」，逐項複核（裁判分數、解析誤判、軟性審查）。
   - 記錄修正意見；若發現裁判系統性偏差，調整 rubric 並於下一輪重跑。

6. **彙整與決策**
   ```bash
   pnpm report                  # 重新生成 reports/leaderboard.md
   ```
   - 以排行榜的綜合分數 + 門檻通過狀態 + `效益/GPU` 提交決策會議。
   - 產出模型服務提案（資源需求、預期效益、適用場景），附上本輪報告。

7. **歸檔**
   - `results/*.json` 為真實來源，需保留並版本化。
   - `reports/*.md` 可由 results 隨時重生，無需特別保存。

## 准入 / 汰換規則（範例，待定案）

- **准入上線**：綜合分數達標 **且** 通過所有品質門檻。
- **列入觀察**：綜合分數接近但某一非關鍵門檻略未過。
- **淘汰**：關鍵門檻（安全、繁中、延遲）未過，或 `效益/GPU` 明顯劣於同級替代。

## 可重現性檢查（每季或換裁判時）

- 固定 seed、資料集版本、裁判 model@version，重跑同一模型，確認綜合分數誤差 < 2%。
- 任一資料集更新都應提升其 `version`，避免新舊成績誤比。
