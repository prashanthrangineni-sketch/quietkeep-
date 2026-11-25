# Hand-off: "Company codes" approval screen on the founder dashboard

**From:** Thread 3, QuietKeep Privacy & Security (25 Nov 2026)
**To:** the thread building the founder command centre on pranixailabs.com/founder (repo `prashanthrangineni-sketch/pranix-ai-labs`, `app/founder/*`, `app/api/founder/*`)
**Founder's words (25 Nov):** "Prepare an option for company codes that are approved by founder on his dashboard under his QuietKeep Business and Personal dashboard."

## What exists on the QuietKeep side (built, tested, yours to call)

A company code gives a QuietKeep plan free for a set number of days. Codes are made **only** when the founder approves a request. One server door does everything:

`https://quietkeep.com/api/founder/codes` (server to server only; never call it from the browser)

| Call | What it does |
| --- | --- |
| `GET /api/founder/codes` | Every request, waiting ones first, with `codes_made` and `times_used` |
| `GET /api/founder/codes?batch=<id>` | The codes of one batch, each with `uses_count`, `max_uses`, `is_active` |
| `POST {action:"request", requested_by, app, plan_tier, days, code_count, uses_each?, purpose?, codes_expire_at?}` | Saves a request as `pending`. Makes no codes. |
| `POST {action:"approve", batch, by}` | Makes the codes and returns them in `codes`, each as `{code, uses_count, max_uses, is_active, expires_at}` (the same shape as `GET ?batch=`) |
| `POST {action:"decline", batch, by, reason?}` | Declines a waiting request |
| `POST {action:"cancel", batch, by}` | Switches off every code in an approved batch. Plans already given stay until their end date. |

Limits enforced on the QuietKeep side: `app` is `personal` or `business`; personal gives `plus` or `family`, business gives `business` (Rs 299 plan) or `growth` (Rs 999 "Business Team"); `days` 1 to 365; `code_count` 1 to 1000; `uses_each` 1 to 1000. A request can be approved once.

## How to sign a call

Both sites hold the same long secret in the setting `FOUNDER_DASHBOARD_KEY` (at least 32 characters; the founder pastes it into both Vercel projects). The secret is never sent. Each call carries two headers:

```
x-founder-timestamp: <unix seconds, now>
x-founder-signature: hex( HMAC-SHA256( FOUNDER_DASHBOARD_KEY, timestamp + "." + METHOD + "." + payload ) )
```

`payload` is the exact request body text for POST; for GET it is the value of `batch` (empty text when listing). A call older than 5 minutes is refused. Reference code: `src/lib/founder-signature.js` in this repo (`signFounderRequest`). Until the key is set on QuietKeep the door answers 503 "Founder dashboard link is not set up yet."

## What to build on the dashboard (your side)

1. Under the founder's **QuietKeep Personal** and **QuietKeep Business** sections, a "Company codes" card each, filtered by `app`.
2. **Waiting for approval** list: who asked, purpose, plan, days, how many codes, uses per code. Two buttons: **Approve** and **Decline** (decline asks for a short reason).
3. **New request** form (the founder can raise and approve his own; team members and agents can raise only).
4. **Approved batches**: codes made, times used, a "Show codes" button (copy all, download as a list), and **Cancel batch**.
5. Only the signed-in founder may press Approve, Decline or Cancel. Send his name in `by`.
6. Sign on your server (a route under `app/api/founder/`), never in the page, so the secret stays off the browser.

## Privacy and safety conditions (Thread 3)

- The dashboard never stores the codes; it reads them from QuietKeep when the founder opens a batch.
- No customer names, emails or phone numbers cross this door in either direction. It carries counts only.
- `FOUNDER_DASHBOARD_KEY` is its own key, used for nothing else, and is on the QuietKeep rotation list.
- Thread 3 will test your screen against the live door before the founder is asked to merge your pull request.

## Done when

The founder opens his dashboard, sees a waiting request, presses Approve, sees the codes, enters one on quietkeep.com/subscription with a test account, and the plan shows as active with an end date.
