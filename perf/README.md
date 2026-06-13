# perf/ — 負載與吞吐壓測

管線內的 `performance` 維度是 **smoke 等級**（單執行緒、依序）的延遲量測，用來餵品質門檻（P95 TTFT、錯誤率）。真正的並發 / 吞吐壓測在此目錄，獨立於評分流程執行。

## k6（端到端，含閘道）

量測使用者實際體驗（走 LiteLLM）。

```bash
BASE_URL=http://litellm.internal:4000 \
API_KEY=$LITELLM_API_KEY \
MODEL=llama-3.3-70b-instruct \
k6 run perf/k6-load-test.js
```

門檻對齊提案：`p(95) TTFT < 2000ms`、錯誤率 `< 0.5%`。

## vLLM / genai-perf（引擎層，定位瓶頸）

量測推理引擎本身的吞吐與 VRAM 占用，協助決定「模型 × 量化 × 並發」的最佳組合。

```bash
# 範例：vLLM 內建 benchmark
vllm bench serve \
  --model <hf-or-local-path> \
  --num-prompts 200 \
  --request-rate 10

# 或 NVIDIA genai-perf
genai-perf profile -m <model> --service-kind openai --endpoint v1/chat/completions
```

## 建議流程

1. 先用評測管線跑完 8 維度，篩出**通過品質門檻**的候選模型。
2. 對候選模型用 k6 量測閘道層的並發行為（延遲、錯誤率）。
3. 對需要定位瓶頸者，用 vLLM/genai-perf 量測引擎層吞吐與 VRAM。
4. 將吞吐 / VRAM 回填到設定檔，計算 `效益/GPU`，做最終取捨。
