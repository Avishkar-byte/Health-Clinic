# Healthcare Appointment & Follow-up Manager

Patient / doctor / admin portals for a clinic, built around one idea: **correctness under concurrency is enforced by the database, not application code.** Slots are physical rows with a uniqueness constraint, not computed ranges — so double-booking is a constraint violation, not a race condition you hope never happens. AI pre- and post-visit summaries, email notifications, and Google Calendar sync are all built as an enhancement layer with a deterministic fallback — an LLM outage or a Calendar API 500 never blocks a booking.

Built for a take-home assignment during an on-campus recruitment drive with **Unthinkable Solutions** — see [Problem statement → how this project addresses it](#problem-statement--how-this-project-addresses-it) below for the original brief and the mapping.

[![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-DC382D?logo=redis&logoColor=white)](https://bullmq.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

The full design rationale — why slots are physical rows, the exact SQL behind the hold→confirm flow, the outbox/queue reliability model, the LLM failure ladder — lives in **[`solution-architecture.md`](./solution-architecture.md)**. This file is the map; that file is the territory.

---

## Booking flow, at a glance

```
Patient searches doctors by specialisation
      │
      ▼
GET /doctors/:id/slots ──── read-only, shows live availability
      │
      ▼
POST /slots/:id/hold ──── atomic UPDATE, 10-minute hold, lazy-expiry
      │  (patient fills the symptom form during the hold window)
      ▼
POST /appointments ──── one DB transaction: consume hold, insert
      │                  appointment + symptom submission + outbox events
      ▼
   201 response in ~50ms — nothing slow happened inside the request
      │
      ├──▶ outbox → llm.previsit queue ──▶ AI triage summary (or graceful degrade)
      ├──▶ outbox → email.send queue   ──▶ confirmation email, patient + doctor
      └──▶ outbox → calendar.sync queue ──▶ Google Calendar event, per participant
```

Every arrow after "201 response" happens in a background worker, driven by
a transactional outbox — the domain write and the intent-to-notify commit
in the *same* database transaction, so there's no "appointment saved but
email lost" failure mode. See [`solution-architecture.md` §7](./solution-architecture.md#7-notification-reliability).

---

## Problem statement → how this project addresses it

<details>
<summary>Original brief (click to expand)</summary>

> A clinic needs more than a basic booking form. Patients want to share
> symptoms in advance and get reminders, doctors want a quick summary
> before each visit, and both sides expect timely confirmations on email
> and their calendar. Build a healthcare appointment platform with
> separate portals for patients, doctors, and an admin. It should let
> patients book appointments, give the doctor an AI symptom summary
> before the visit, produce a patient-friendly summary after the visit,
> and keep both sides informed through email and Google Calendar.

</details>

| Requirement | How it's addressed | Where |
|---|---|---|
| Separate patient / doctor / admin portals, role-based auth | JWT (15 min access, 7 day rotating refresh), route guard + resource-ownership check | `apps/web/src/app/{patient,doctor,admin}`, `apps/api/src/modules/auth` |
| Admin creates/manages doctor profiles (specialisation, hours, slot duration, leave) | Add-doctor form + weekly-availability editor in the admin portal; leave creation cascades to affected bookings | `apps/web/src/app/admin/doctors`, `apps/api/src/modules/{users,availability,leaves}` |
| Patient registers, logs in, searches by specialisation, books a slot | Standard auth flow; `GET /doctors?specialisation=` discovery; hold→confirm booking | `apps/api/src/modules/{auth,users,slots,appointments}` |
| **Prevent double-booking; handle simultaneous booking attempts safely** | `UNIQUE(doctor_id, start_ts)` on the `slots` table turns concurrent bookings into a single-row atomic `UPDATE ... WHERE status='available'` — the loser gets 0 rows affected, not a corrupted state. Verified with a test that fires 50 concurrent booking requests at one slot and asserts exactly 1 succeeds. | `apps/api/src/modules/slots/slots.service.ts`, `tests/concurrency.spec.ts` |
| **Doctor on leave with existing bookings → affected patients notified** | Leave creation takes `FOR UPDATE` row locks on every slot in the range (serialises against in-flight bookings), cancels affected appointments, and enqueues a notification + calendar-delete per patient in the same transaction. | `apps/api/src/modules/leaves/leaves.service.ts`, `tests/leave-conflict.spec.ts` |
| Symptom form before confirming; LLM pre-visit summary with urgency | Zod-validated symptom form; worker calls the LLM with the exact prompt from the brief, validates the JSON response, and applies a **deterministic urgency floor** (keyword rules for chest pain, breathlessness, etc.) that the LLM can raise but never lower | `apps/worker/src/processors/llm-previsit.processor.ts`, `packages/prompts/src/previsit.ts` |
| Doctor submits notes + prescription; LLM patient-friendly post-visit summary | Same pattern — the prescription itself is **never** LLM-generated (structured data from the doctor), the LLM only rewrites prose around it | `apps/worker/src/processors/llm-postvisit.processor.ts`, `packages/prompts/src/postvisit.ts` |
| Medication reminders based on prescription frequency | Reminder schedule is **materialised** (one row per dose) at prescription time from the frequency table (OD/BD/TDS/QID/WEEKLY/SOS), not computed on the fly — so a scheduler restart can't drift and a patient can skip an individual dose | `apps/api/src/modules/clinical/clinical.service.ts` |
| Email: booking confirmation, reminder, cancellation, both sides | Provider-agnostic SMTP (nodemailer) worker, templated per event, with a DB-backed retry ladder | `apps/worker/src/processors/email.processor.ts` |
| Google Calendar event on booking; updated/deleted on cancel | OAuth 2.0 per-participant (patient and doctor each connect their own calendar), idempotent event IDs (`sha1(appointmentId + userId)`), tokens encrypted at rest | `apps/worker/src/google-calendar.ts`, `apps/worker/src/processors/calendar.processor.ts` — **see [constraints below](#known-limitations--operational-constraints)** |
| LLM failures handled gracefully, system doesn't break | 4-level ladder: retry (backoff) → schema-repair reprompt → degrade (doctor sees raw symptom form, patient sees the structured prescription table) → circuit breaker. Booking is never blocked on the LLM — it's not even in the request path. | `apps/worker/src/processors/llm-*.processor.ts`, `tests/llm-failure.spec.ts` |
| Background job for reminders + email retries | In-process tick (sweeper, outbox relay, reminder dispatch, slot-horizon regeneration) — see the free-tier note in Deployment | `apps/api/src/modules/internal/internal.controller.ts` |

---

## Design write-up (the four required topics)

**Double-booking prevention.** Correctness is enforced by a database uniqueness constraint, not application logic. `slots` are materialised physical rows (`UNIQUE(doctor_id, start_ts)`), not ranges computed at query time — the naive "check available, then insert" approach is a classic check-then-act race under concurrent requests. Booking becomes a single conditional `UPDATE slots SET status='booked' WHERE status='available'`; Postgres serialises concurrent writes to the same row, and the loser's `UPDATE` simply affects 0 rows. A `50` parallel-request test asserts exactly 1 success.

**Slot hold mechanism.** A patient needs time to fill the symptom form before committing to a slot. `POST /slots/:id/hold` atomically flips a slot to `held` with a 10-minute expiry, in the same conditional-`UPDATE` style as booking. The clever part: the hold-acquire query's `WHERE` clause accepts a slot that's `available` **or** `held with an expired hold_expires_at` — so correctness never depends on a sweeper job running to reclaim stale holds. On a free hosting tier where a background tick can pause, this matters: the system stays correct even if cleanup lags, because expiry is checked lazily at the point of contention, not asynchronously in advance.

**Doctor leave conflict handling.** Marking leave is the one operation that mutates already-confirmed state, so it's a single serialised transaction: `SELECT ... FOR UPDATE` on every slot in the affected range (blocking any in-flight hold/confirm on those slots), insert the leave, mark the slots `blocked`, then cancel and notify every affected appointment. The race this closes: a patient confirms a booking at the exact millisecond an admin marks leave. Because the leave transaction holds row locks on every slot first, the booking either commits first (and is then caught and cancelled by the leave transaction) or blocks until the leave commits, after which its own `status='available'` precondition fails. There's no interleaving where a booking survives inside a leave window.

**Notification failure handling.** A transactional outbox: the domain write (booking, cancellation) and the intent-to-notify are inserted in the *same* database transaction, so there's no way to save an appointment and silently lose its email. A relay polls unpublished outbox rows and enqueues them to BullMQ — at-least-once delivery, made safe by a `dedupe_key` (`sha256(appointmentId:template:recipient)`) with a unique constraint, so a redelivered job is a no-op insert rather than a duplicate email. Failed sends follow a graduated retry (1m → 5m → 15m → 1h → 6h) before landing in an admin-visible dead-letter queue with a manual resend action — nothing fails silently. Calendar sync and LLM calls follow the identical outbox pattern, just against different queues.

*(Full depth, including the exact SQL and the reschedule/deadlock-avoidance ordering, in [`solution-architecture.md`](./solution-architecture.md).)*

---

## Tech stack

| Layer | Technology |
|---|---|
| API | NestJS (Node/TypeScript), Prisma ORM |
| Database | PostgreSQL — [Neon](https://neon.tech) (free tier) |
| Queue / background jobs | BullMQ on Redis — [Upstash](https://upstash.com) (free tier) |
| LLM | Groq or Gemini — both expose an OpenAI-compatible endpoint, swappable via env var, see `apps/worker/src/llm-client.ts` |
| Email | SMTP via nodemailer — provider-agnostic, tested with [Resend](https://resend.com) (free tier) |
| Calendar | Google Calendar API v3, OAuth 2.0 |
| Frontend | Next.js (App Router) |
| Deployment | Vercel (frontend) + Render Docker web service (API + worker) — both free tier |

## Repo structure

```
apps/
  api/      NestJS — controllers, services, guards, one module per domain concept
  worker/   BullMQ processors (llm-previsit, llm-postvisit, email, calendar)
  web/      Next.js — patient / doctor / admin routes
packages/
  db/       Prisma schema (source of truth for the DB schema), seed data
  contracts/  Shared zod schemas/DTOs — single source of truth for API request/response shapes
  prompts/  Versioned LLM prompt templates (the exact prompts from the brief)
tests/      Integration tests against a running API instance (concurrency,
            idempotency, hold-expiry, leave-conflict, dedupe, LLM-failure)
```

---

## Running locally

Requires Node 20+, pnpm 9+, and a `.env` in the repo root (copy `.env.example` — every variable is commented with what it does and where to get a free one: Neon, Upstash, Groq/Gemini, Resend, Google Cloud Console).

```bash
pnpm install
pnpm db:push        # sync the Prisma schema to your database
pnpm db:seed         # demo doctors/specialisations + an admin account
pnpm dev             # api (:4000) + worker + web (:3000), all together
```

Or one piece at a time: `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`. The frontend needs its own `apps/web/.env.local` — copy `apps/web/.env.example`.

**Demo login** (from `pnpm db:seed`): `admin@clinic.local` / `password123`, and 5 seeded doctors (`anand@clinic.local` etc.) with the same password.

## Tests

```bash
pnpm test
```

Runs the API's unit tests plus the integration suite in `tests/` — the integration tests expect a running API at `http://localhost:4000` (`pnpm dev:api`) and seeded data. Covers: 50-way booking concurrency, idempotency-key replay, hold expiry, leave-conflict cascade cancellation, notification dedup, LLM-failure degradation, and the urgency-floor rules.

## Database schema

Prisma is the single source of truth: [`packages/db/prisma/schema.prisma`](./packages/db/prisma/schema.prisma). The critical table is `slots` — see [`solution-architecture.md` §3](./solution-architecture.md#3-data-model) for the full model and the reasoning behind materialising slots as physical rows instead of computing availability from `doctor_availability` at query time.

## LLM prompts

Exact prompts, versioned, in [`packages/prompts/src`](./packages/prompts/src):

**Pre-visit** (`previsit.v2`) — system message enforces JSON-only output and a safe fallback for empty/nonsensical input; user message asks for `urgency`, `chief_complaint`, `suggested_questions` (exactly 3), and `red_flags`, matching the brief's guidance almost verbatim. The LLM's `urgency` is then passed through a **deterministic keyword floor** (chest pain, breathlessness, severity ≥ 9, etc.) that can only raise it, never lower it — a hallucinating or unavailable model can't cause an emergency to be triaged as routine.

**Post-visit** (`postvisit.v2`) — converts clinical notes + the doctor's structured prescription into a `summary`, `medication_schedule`, `follow_up_steps`, and `warning_signs`, explicitly instructed not to add information not in the notes and never to alter a dose or frequency.

## API reference

Condensed — see controllers under `apps/api/src/modules/*` for the complete surface.

```
AUTH        POST /auth/register · POST /auth/login · POST /auth/refresh · POST /auth/logout
DISCOVERY   GET /specialisations · GET /doctors?specialisation=&q= · GET /doctors/:id/slots
BOOKING     POST /slots/:id/hold · DELETE /holds/:token
            POST /appointments (Idempotency-Key required) · POST /appointments/:id/cancel
            GET /appointments · GET /appointments/:id
CLINICAL    GET /appointments/:id/pre-visit · POST /appointments/:id/notes
            GET /appointments/:id/post-visit · GET /patients/me/medications
ADMIN       POST /admin/doctors · PATCH /admin/doctors/:id
            PUT|GET /admin/doctors/:id/availability
            POST /admin/doctors/:id/leaves · GET /admin/doctors/:id/leaves/preview
            GET /admin/notifications/dead · POST /admin/notifications/:id/retry
INTEGRATIONS  GET /integrations/google/{status,connect,callback} · DELETE /integrations/google
INTERNAL    POST /internal/tick (CRON_SECRET header) — sweep holds, dispatch reminders,
            process outbox, regenerate the slot horizon
```

Every 4xx follows RFC 7807 (`problem+json`) with a machine-readable `code` — see `apps/api/src/common/exceptions/problem.exceptions.ts`.

---

## Google Calendar setup

Calendar sync is fully implemented (real OAuth token exchange, encrypted storage, per-participant Calendar API create/update/delete with idempotent event IDs) — but Google requires you to register your own OAuth client to use it:

1. **[Google Cloud Console](https://console.cloud.google.com/apis/credentials)** → create a project (or pick one) → **APIs & Services → Library** → enable the **Google Calendar API**.
2. **APIs & Services → OAuth consent screen** → configure it (External is fine for testing) → add the scope `https://www.googleapis.com/auth/calendar.events`.
3. On that same consent screen, add every Google account that should be able to connect their calendar under **Audience → Test users** (see [constraints](#known-limitations--operational-constraints) below — this step isn't optional while the app is unverified).
4. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID → Web application**. Add an **Authorized redirect URI**: `http://localhost:4000/integrations/google/callback` for local dev, plus your deployed API's `.../integrations/google/callback` for production.
5. Copy the **Client ID** (the *full* string, including the leading numeric project prefix — `123456789012-abc...apps.googleusercontent.com`) and **Client secret** (`GOCSPX-...`) into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.
6. In the app, go to **Settings** (linked from both the patient and doctor portal nav) → **Connect Google Calendar**.

## Known limitations / operational constraints

Two real, disclosed constraints from running this on free-tier services — not bugs, but worth knowing before you assume calendar/email "just work" for arbitrary users:

- **Google Calendar only works for accounts added as OAuth test users.** An unverified Google OAuth app (the free/default state, and the only reasonable one for a project like this) restricts sign-in to accounts explicitly added under Cloud Console → OAuth consent screen → Test users — up to 100. Anyone else gets Google's `Error 403: access_denied`. Submitting the app for Google's verification review would lift this, but requires a privacy policy page, domain verification, and a manual review (`calendar.events` is a sensitive scope) — disproportionate for a project with a small, known user base.
- **Email delivery needs a verified sending domain.** Free-tier transactional email providers (Resend, in this project's case) restrict their default sandbox sender to delivering only to the account owner's own address, specifically to prevent spam abuse from unverified senders. Booking confirmations to *other* real patients/doctors require verifying a domain you control (a few DNS records — SPF/DKIM — added once) and setting `SMTP_FROM` to an address on that domain.

Neither constraint affects booking itself — both integrations degrade gracefully by design (§8 of the architecture doc: "if the patient hasn't connected Google at all, booking still works"; the in-app notification list is always the backstop of record even if email delivery is delayed or restricted).

## Deployment

- **Frontend** → Vercel. Set `NEXT_PUBLIC_API_URL` to the deployed API URL.
- **API + worker** → a single Render Docker web service (`Dockerfile`, `render.yaml`) — both processes run in one container via `docker-entrypoint.sh`, which stops the container if either process dies rather than continuing silently half-working. The API and worker were designed as independently deployable services (nothing in the code assumes they're colocated) and can be split back into two Render services; they're combined here to fit one free-tier instance.

See `solution-architecture.md`'s deployment topology section for the free-tier tradeoffs this implies — notably, no paid cron job, so the sweeper/reminder tick runs in-process and pauses if the instance sleeps. Correctness never depends on it (hold expiry is checked lazily, see the design write-up above); timely reminder/email delivery does. An external uptime pinger (e.g. UptimeRobot, free) hitting `/health` keeps the instance warm if that matters for your use case.

## Security

- Argon2id password hashing; JWT access (15 min) + rotating refresh (7 day) tokens.
- Route-level role guard **and** resource-ownership check on every clinical record access — a doctor requesting appointment `X` must be `X`'s doctor; never trust an ID from the URL alone.
- OAuth tokens (Google Calendar) encrypted at rest with AES-256-GCM (`packages/contracts/src/crypto.ts`). `ENCRYPTION_KEY` must be identical wherever the API and worker run — one encrypts, the other decrypts.
- Rate limiting: global default plus a tighter limit on `/auth/login` and `/auth/register` specifically, against brute force.
- Every 4xx carries a machine-readable `code`; 5xx responses never leak internal error details to the client.
- `.gitignore` covers `.env*` and a `/scratch/` convention for one-off local debug scripts, so a quick local test script with a real connection string in it can't get committed by accident.

## License

MIT
