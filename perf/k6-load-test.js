/*
 * k6 concurrency / throughput load test against a LiteLLM OpenAI-compatible
 * endpoint. The in-process `performance` dimension is only a smoke measurement;
 * this script is the real concurrency test referenced by the SOP.
 *
 * Usage:
 *   BASE_URL=http://litellm.internal:4000 \
 *   API_KEY=$LITELLM_API_KEY \
 *   MODEL=llama-3.3-70b-instruct \
 *   k6 run perf/k6-load-test.js
 *
 * Thresholds mirror the proposal's quality gates (P95 TTFT < 2s, errors < 0.5%).
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API_KEY = __ENV.API_KEY || '';
const MODEL = __ENV.MODEL || 'sample-model';

const ttft = new Trend('ttft_ms', true);
const errorRate = new Rate('chat_errors');

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 25 },
        { duration: '2m', target: 25 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    ttft_ms: ['p(95)<2000'],
    chat_errors: ['rate<0.005'],
    http_req_duration: ['p(95)<15000'],
  },
};

const PROMPTS = [
  'Summarize the benefits of retrieval-augmented generation in two sentences.',
  'Explain the difference between latency and throughput for an LLM serving system.',
  'List five considerations for deploying open-source LLMs on constrained GPUs.',
];

export default function () {
  const body = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: PROMPTS[Math.floor(Math.random() * PROMPTS.length)] }],
    max_tokens: 256,
    temperature: 0,
    stream: false,
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/v1/chat/completions`, body, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
  });
  ttft.add(Date.now() - start);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'has content': (r) => {
      try {
        return !!JSON.parse(r.body).choices[0].message.content;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
}
