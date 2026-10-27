# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-27T07:34:11.226Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | measured | 52.5% (21/40) | 30% (12/40) | 52.5% (21/40) | 52.5% (21/40) | 52.5% (21/40) | 45% (18/40) | 40% (16/40) | 0.429 |
| shakti:qwen2.5-vl-72b | measured | 7.5% (3/40) | 5% (2/40) | 7.5% (3/40) | 7.5% (3/40) | 7.5% (3/40) | 7.5% (3/40) | 5% (2/40) | 0.000 |
| shakti:gemma-3-27b | measured | 15% (6/40) | 15% (6/40) | 15% (6/40) | 15% (6/40) | 15% (6/40) | 15% (6/40) | 15% (6/40) | 0.000 |
| shakti:llama-4-maverick | measured | 37.5% (15/40) | 25% (10/40) | 37.5% (15/40) | 37.5% (15/40) | 37.5% (15/40) | 37.5% (15/40) | 25% (10/40) | 0.225 |
| gemini:gemini-3.5-flash-lite | measured | 100% (40/40) | 90% (36/40) | 100% (40/40) | 100% (40/40) | 100% (40/40) | 92.5% (37/40) | 97.5% (39/40) | 0.875 |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 70% (7/10) | 37.5% (3/8) | 0% (0/8) | 0% (0/6) | 25% (2/8) |
| shakti:qwen2.5-vl-72b | 0% (0/10) | 0% (0/8) | 0% (0/8) | 0% (0/6) | 25% (2/8) |
| shakti:gemma-3-27b | 0% (0/10) | 0% (0/8) | 0% (0/8) | 0% (0/6) | 75% (6/8) |
| shakti:llama-4-maverick | 10% (1/10) | 0% (0/8) | 0% (0/8) | 83.3% (5/6) | 50% (4/8) |
| gemini:gemini-3.5-flash-lite | 100% (10/10) | 62.5% (5/8) | 100% (8/8) | 100% (6/6) | 87.5% (7/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 0% (0/11) | 30% (3/10) | 63.6% (7/11) | 25% (2/8) |
| shakti:qwen2.5-vl-72b | 0% (0/11) | 0% (0/10) | 9.1% (1/11) | 12.5% (1/8) |
| shakti:gemma-3-27b | 9.1% (1/11) | 20% (2/10) | 18.2% (2/11) | 12.5% (1/8) |
| shakti:llama-4-maverick | 18.2% (2/11) | 0% (0/10) | 45.5% (5/11) | 37.5% (3/8) |
| gemini:gemini-3.5-flash-lite | 81.8% (9/11) | 90% (9/10) | 90.9% (10/11) | 100% (8/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 8.29 s | 23.50 s | 0 / 19 / 0 / 0 | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |
| shakti:qwen2.5-vl-72b | 4.33 s | 15.37 s | 0 / 0 / 0 / 0 | not looked up |
| shakti:gemma-3-27b | 1.72 s | 8.66 s | 0 / 0 / 0 / 0 | not looked up |
| shakti:llama-4-maverick | 2.62 s | 10.30 s | 0 / 0 / 0 / 0 | not looked up |
| gemini:gemini-3.5-flash-lite | 1.94 s | 23.50 s | 0 / 0 / 0 / 0 | [not re-checked for 3.5 - see the pricing page](https://ai.google.dev/gemini-api/docs/pricing) |

## Not Measured / Skipped

- Every requested model was measured.
