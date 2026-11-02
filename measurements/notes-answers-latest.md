# Notes-grounded answers (EdGridAI doubt-solver pattern) - measured

Measured 2026-11-02T12:02:32.750Z. 24 synthetic cases (18 answerable: 6 en / 6 hi / 6 te; 6 whose answer is not in the notes). Measurement only - no app calls these models.

| Model | Answered right | English | Hindi | Telugu | Same language | Said "not in notes" when right to | Wrongly refused | Errors | Median reply |
|---|---|---|---|---|---|---|---|---|---|
| sarvam:sarvam-105b-conversations | 100% (18/18) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 100% (18/18) | 100% (6/6) | 0 | 0 | 0.40 s |
| gemini:gemini-3.5-flash-lite | 83.3% (15/18) | 83.3% (5/6) | 83.3% (5/6) | 83.3% (5/6) | 88.9% (16/18) | 100% (6/6) | 2 | 1 | 37.52 s |
| shakti:gpt-oss-120b | 88.9% (16/18) | 66.7% (4/6) | 100% (6/6) | 100% (6/6) | 100% (18/18) | 100% (6/6) | 0 | 0 | 0.83 s |
| shakti:llama-4-maverick | 100% (18/18) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 100% (18/18) | 100% (6/6) | 0 | 0 | 1.07 s |
| shakti:gemma-3-27b | 100% (18/18) | 100% (6/6) | 100% (6/6) | 100% (6/6) | 100% (18/18) | 100% (6/6) | 0 | 0 | 0.63 s |
| shakti:qwen2.5-vl-72b | 94.4% (17/18) | 100% (6/6) | 100% (6/6) | 83.3% (5/6) | 100% (18/18) | 100% (6/6) | 0 | 0 | 1.74 s |

Run: https://github.com/prashanthrangineni-sketch/quietkeep-/actions/runs/41441460189
