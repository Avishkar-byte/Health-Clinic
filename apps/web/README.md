# Frontend

Next.js (App Router) patient / doctor / admin portals. See the
[repo root README](../../README.md) for the full project overview and how
to run everything together, and
[`solution-architecture.md`](../../solution-architecture.md) for design
rationale.

## Local dev (this app only)

```bash
pnpm dev:web       # from the repo root — starts this app on :3000
```

Requires `NEXT_PUBLIC_API_URL` pointing at a running API (defaults to
`http://localhost:4000`).

## Routes

- `/` — login/register
- `/patient/*` — book appointments, view upcoming/past visits, medication reminders
- `/doctor/*` — appointment queue, consult workspace, visit history
- `/admin/*` — doctor onboarding + availability, doctor leave, notification dead-letter queue
- `/settings` — connect/disconnect Google Calendar (patient or doctor)
