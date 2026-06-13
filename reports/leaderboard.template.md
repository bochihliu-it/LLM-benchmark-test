# 🏆 模型評測排行榜 Leaderboard（範本）

> 此檔為版控的範本，說明 `pnpm report` 產生的 `leaderboard.md` 結構。實際排行榜為 git-ignored，可隨時由 `results/*.json` 重生。

| # | Model | Overall | Gates | VRAM(GB) | 效益/GPU | general | reasoning | code | zh-tw | rag | tool-use | safety | performance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | _model label_ | **0.0** | ✅/❌ | – | – | – | – | – | – | – | – | – | – |

## 圖例 Legend

- **Overall**：各維度 0–100，依群組權重加權的綜合分數。
- **Gates**：✅ 通過全部上線門檻；❌ 至少一項未達標（即使綜合分數高也不建議上線）。
- **效益/GPU**：綜合分數 ÷ VRAM(GB)，PCAI 有限資源下的取捨依據。
- 維度欄為 0–100；`–` 表示該維度未納入該次評測。
