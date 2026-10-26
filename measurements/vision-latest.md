# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-26T17:51:12.716Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured - every call failed (http_429x40) ({"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain) | - | - | - | - | - | - | - | - |
| gemini:gemini-3.5-flash-lite | measured | 100% (40/40) | 57.5% (23/40) | 80% (32/40) | 100% (40/40) | 100% (40/40) | 90% (36/40) | 97.5% (39/40) | 0.675 |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | 100% (10/10) | 50% (4/8) | 100% (8/8) | 16.7% (1/6) | 0% (0/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | 54.5% (6/11) | 60% (6/10) | 54.5% (6/11) | 62.5% (5/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured | not measured | - | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |
| gemini:gemini-3.5-flash-lite | 12.04 s | 22.79 s | 0 / 0 / 0 / 0 | [not re-checked for 3.5 - see the pricing page](https://ai.google.dev/gemini-api/docs/pricing) |

## Not Measured / Skipped

- **openrouter:nvidia/nemotron-3.5-super-vl:free**: not measured - every call failed (http_429x40) - {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain
