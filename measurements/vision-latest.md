# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-26T17:14:56.151Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | measured | 0% (0/40) | 0% (0/40) | 0% (0/40) | 0% (0/40) | 0% (0/40) | 0% (0/40) | 0% (0/40) | 0.000 |
| gemini:gemini-2.5-flash-lite | not offered (HTTP 404: [{ "error": { "code": 404, "message": "This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api/doc) | - | - | - | - | - | - | - | - |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 0% (0/10) | 0% (0/8) | 0% (0/8) | 0% (0/6) | 0% (0/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 0% (0/11) | 0% (0/10) | 0% (0/11) | 0% (0/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | n/a | n/a | 0 / 40 / 0 / 0 | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |
| gemini:gemini-2.5-flash-lite | not measured | not measured | - | [$0.10 in / $0.40 out per 1M tokens, paid tier](https://ai.google.dev/gemini-api/docs/pricing) |

## Not Measured / Skipped

- **gemini:gemini-2.5-flash-lite**: not offered - HTTP 404: [{ "error": { "code": 404, "message": "This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api/doc
