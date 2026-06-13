# 🏆 模型評測排行榜 Leaderboard（範本）

> 此檔為版控的範本，說明 `pnpm report` 產生的 `leaderboard.md` 結構。實際排行榜（含 `leaderboard.csv`）為 git-ignored，可隨時由 `results/*.json` 重生。

| # | Model | Overall | Decision | Gates | VRAM(GB) | 效益/GPU | general | reasoning | code | zh-tw | rag | tool-use | safety | performance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | _model label_ | **0.0** | 🟢/🟡/🔴 | ✅/❌ | – | – | – | – | – | – | – | – | – | – |

## 決策矩陣 Decision matrix

| Model | Overall | 效益/GPU | 建議 Decision | 理由 Reason |
| --- | ---: | ---: | --- | --- |
| _model label_ | 0.0 | – | 🟢 上線 Go-live | _rationale_ |

## 圖例 Legend

- **Overall**：各維度 0–100，依群組權重加權的綜合分數。
- **Decision**：🟢 上線（綜合 ≥ goLiveThreshold 且通過所有 blocking 門檻）｜🟡 觀察｜🔴 淘汰（blocking 門檻未過）。
- **Gates**：✅ 通過全部 blocking 門檻；❌ 至少一項 blocking 未達標。
- **效益/GPU**：綜合分數 ÷ VRAM(GB)，PCAI 有限資源下的取捨依據。
- 維度欄為 0–100；`–` 表示該維度未納入該次評測。
