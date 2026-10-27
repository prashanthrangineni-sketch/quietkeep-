# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-27T08:52:26.514Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| shakti:qwen2.5-vl-72b | measured | 100% (40/40) | 77.5% (31/40) | 100% (40/40) | 100% (40/40) | 100% (40/40) | 97.5% (39/40) | 77.5% (31/40) | 0.575 |
| shakti:gemma-3-27b | measured | 100% (40/40) | 72.5% (29/40) | 100% (40/40) | 95% (38/40) | 97.5% (39/40) | 87.5% (35/40) | 97.5% (39/40) | 0.619 |
| shakti:llama-4-maverick | measured | 97.5% (39/40) | 67.5% (27/40) | 97.5% (39/40) | 97.5% (39/40) | 97.5% (39/40) | 95% (38/40) | 70% (28/40) | 0.742 |
| gemini:gemini-3.5-flash-lite | measured | 100% (40/40) | 92.5% (37/40) | 100% (40/40) | 100% (40/40) | 100% (40/40) | 95% (38/40) | 97.5% (39/40) | 0.875 |
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured - provider daily limit reached (after 0 answers) ({"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain) | - | - | - | - | - | - | - | - |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| shakti:qwen2.5-vl-72b | 70% (7/10) | 75% (6/8) | 75% (6/8) | 100% (6/6) | 75% (6/8) |
| shakti:gemma-3-27b | 80% (8/10) | 25% (2/8) | 87.5% (7/8) | 66.7% (4/6) | 100% (8/8) |
| shakti:llama-4-maverick | 50% (5/10) | 75% (6/8) | 87.5% (7/8) | 83.3% (5/6) | 50% (4/8) |
| gemini:gemini-3.5-flash-lite | 100% (10/10) | 75% (6/8) | 100% (8/8) | 100% (6/6) | 87.5% (7/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| shakti:qwen2.5-vl-72b | 18.2% (2/11) | 100% (10/10) | 100% (11/11) | 100% (8/8) |
| shakti:gemma-3-27b | 72.7% (8/11) | 60% (6/10) | 72.7% (8/11) | 87.5% (7/8) |
| shakti:llama-4-maverick | 45.5% (5/11) | 50% (5/10) | 90.9% (10/11) | 87.5% (7/8) |
| gemini:gemini-3.5-flash-lite | 81.8% (9/11) | 100% (10/10) | 90.9% (10/11) | 100% (8/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| shakti:qwen2.5-vl-72b | 5.99 s | 14.49 s | 0 / 0 / 0 / 0 | not looked up |
| shakti:gemma-3-27b | 2.86 s | 14.92 s | 0 / 0 / 0 / 0 | not looked up |
| shakti:llama-4-maverick | 3.14 s | 10.56 s | 0 / 0 / 0 / 0 | not looked up |
| gemini:gemini-3.5-flash-lite | 1.18 s | 2.27 s | 0 / 0 / 0 / 0 | [not re-checked for 3.5 - see the pricing page](https://ai.google.dev/gemini-api/docs/pricing) |
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured | not measured | - | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |

## Not Measured / Skipped

- **openrouter:nvidia/nemotron-3.5-super-vl:free**: not measured - provider daily limit reached (after 0 answers) - {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain
