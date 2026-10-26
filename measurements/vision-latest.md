# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-26T18:15:57.629Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured - every call failed (http_429x40) ({"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain) | - | - | - | - | - | - | - | - |
| gemini:gemini-3.5-flash-lite | measured | 95% (38/40) | 85% (34/40) | 95% (38/40) | 95% (38/40) | 95% (38/40) | 87.5% (35/40) | 92.5% (37/40) | 0.825 |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | 100% (10/10) | 37.5% (3/8) | 100% (8/8) | 100% (6/6) | 87.5% (7/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| gemini:gemini-3.5-flash-lite | 81.8% (9/11) | 90% (9/10) | 72.7% (8/11) | 100% (8/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | not measured | not measured | - | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |
| gemini:gemini-3.5-flash-lite | 6.48 s | 41.53 s | 0 / 2 / 0 / 0 | [not re-checked for 3.5 - see the pricing page](https://ai.google.dev/gemini-api/docs/pricing) |

## Not Measured / Skipped

- **openrouter:nvidia/nemotron-3.5-super-vl:free**: not measured - every call failed (http_429x40) - {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","code":429,"metadata":{"headers":{"X-RateLimit-Limit":"50","X-RateLimit-Remain
