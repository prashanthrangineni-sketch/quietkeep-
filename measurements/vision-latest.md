# Vision extraction benchmark - Indian bills, receipts & product labels

Measured 2026-10-28T05:30:41.991Z. Test suite: 40 synthetic images with Playwright/Chromium rendering across 5 document types and 4 script categories.
Models evaluated for QuickScanZ and Cart2Save fact extraction. Timeout: 45000 ms.

## Overall Extraction Accuracy

| Model | Status | JSON Valid | All Checks Pass | Total Exact | Date Exact | MRP Exact | Expiry Exact | Merchant Fuzzy | Items Avg F1 |
|---|---|---|---|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | measured | 67.5% (27/40) | 50% (20/40) | 67.5% (27/40) | 67.5% (27/40) | 67.5% (27/40) | 62.5% (25/40) | 57.5% (23/40) | 0.542 |
| gemini:gemini-3.5-flash-lite | measured | 100% (40/40) | 90% (36/40) | 100% (40/40) | 100% (40/40) | 100% (40/40) | 92.5% (37/40) | 97.5% (39/40) | 0.875 |

## Accuracy by Document Type

| Model | Kirana Bill | Pharmacy Bill | Restaurant Bill | Utility Bill | Product Label |
|---|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 60% (6/10) | 25% (2/8) | 50% (4/8) | 83.3% (5/6) | 37.5% (3/8) |
| gemini:gemini-3.5-flash-lite | 100% (10/10) | 62.5% (5/8) | 100% (8/8) | 100% (6/6) | 87.5% (7/8) |

## Accuracy by Script Category

| Model | Telugu | Hindi | English | Mixed |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 18.2% (2/11) | 40% (4/10) | 72.7% (8/11) | 75% (6/8) |
| gemini:gemini-3.5-flash-lite | 81.8% (9/11) | 100% (10/10) | 81.8% (9/11) | 100% (8/8) |

## Latency, Failures, and Published Price

| Model | Median Reply | 95th pct Reply | Failures (timeout / http / no_json / threw) | Published Price |
|---|---|---|---|---|
| openrouter:nvidia/nemotron-3.5-super-vl:free | 6.84 s | 18.08 s | 2 / 0 / 8 / 0 | [$0 (OpenRouter ":free" variant; rate-limited)](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free) |
| gemini:gemini-3.5-flash-lite | 1.04 s | 1.58 s | 0 / 0 / 0 / 0 | [not re-checked for 3.5 - see the pricing page](https://ai.google.dev/gemini-api/docs/pricing) |

## Not Measured / Skipped

- Every requested model was measured.
