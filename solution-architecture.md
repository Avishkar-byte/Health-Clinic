# Healthcare Appointment & Follow-up Manager — Solution Architecture

**Version:** 1.0
**Scope:** patient / doctor / admin portals, AI pre- and post-visit summaries, email + Google Calendar sync, medication reminders.

---

## 1. Architectural principles

Five decisions drive the whole design. Everything else follows from them.

| # | Decision | Why |
|---|---|---|
| 1 | **Slots are physical rows, not computed ranges.** | Makes double-booking a database constraint violation, not application logic. Concurrency correctness moves from your code into Postgres. |
| 2 | **Booking is two-phase: `HOLD` → `CONFIRM`.** | The patient needs time to fill the symptom form. A hold reserves the slot for 10 minutes without creating a half-real appointment. |
| 3 | **Nothing slow or unreliable runs inside the request.** | LLM calls, emails and Calendar API calls all happen in background workers. An OpenAI outage or a Gmail 503 can never fail a booking. |
| 4 | **Transactional outbox for every side effect.** | Side effects are written in the *same* DB transaction as the domain change. No "appointment saved but email lost" and no "email sent but transaction rolled back". |
| 5 | **The LLM is an enhancer, never a gate.** | Every AI output has a deterministic fallback path. Degraded mode is a first-class state, not an error page. |

---

## 2. System context

```
                      ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                      │   Patient    │  │    Doctor    │  │    Admin     │
                      │    portal    │  │    portal    │  │    console   │
                      └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                             └─────────────────┼─────────────────┘
                                               │  HTTPS / JWT
                                     ┌─────────▼──────────┐
                                     │    API Gateway     │  rate limit, CORS,
                                     │  (NestJS / Express)│  auth guard, RBAC
                                     └─────────┬──────────┘
              ┌───────────────┬────────────────┼────────────────┬───────────────┐
        ┌─────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐ ┌──────▼──────┐
        │  Identity │  │  Scheduling │  │  Clinical   │  │ Notification│ │   Calendar  │
        │  & RBAC   │  │   service   │  │   service   │  │   service   │ │   service   │
        └─────┬─────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ └──────┬──────┘
              └───────────────┴────────┬───────┴────────────────┴───────────────┘
                                       │
                     ┌─────────────────▼──────────────────┐
                     │      PostgreSQL (single source     │
                     │      of truth + outbox table)      │
                     └─────────────────┬──────────────────┘
                                       │ outbox relay (poll 1s)
                     ┌─────────────────▼──────────────────┐
                     │        Redis + BullMQ queues       │
                     │ llm.previsit │ llm.postvisit       │
                     │ email.send   │ calendar.sync       │
                     │ med.reminder │ hold.sweeper        │
                     └──┬──────────┬──────────┬───────────┘
                        │          │          │
                  ┌─────▼───┐ ┌────▼────┐ ┌───▼──────────┐
                  │ LLM API │ │  Email  │ │ Google       │
                  │ (Claude/│ │ provider│ │ Calendar API │
                  │  GPT)   │ │(SendGrid│ │ (OAuth 2.0)  │
                  └─────────┘ └─────────┘ └──────────────┘
```

**Deployment topology (free tier, as actually deployed):**

| Component | Host | Note |
|---|---|---|
| Frontend (React/Next) | Vercel | static + SSR |
| API + Worker (NestJS + BullMQ) | Render Web Service (Docker) | one container, two processes — see `Dockerfile` / `docker-entrypoint.sh` |
| Postgres | Neon | pooled connection |
| Redis | Upstash | queue backend — needs the `rediss://` (ioredis) connection string, **not** Upstash's REST URL |
| Tick (sweeper, reminders, slot horizon) | in-process `setInterval`, every 30s | `InternalController.onModuleInit` — see gotcha below |

The API and worker were designed as separate Render services (a `web` + a `background worker`, each independently scaled and crash-isolated) and can still be run that way — nothing in the code assumes they're colocated. They're combined into a single Docker container here purely to fit one free-tier instance instead of two. `docker-entrypoint.sh` stops the whole container if either process dies, so a worker crash (e.g. a bad `REDIS_URL`) surfaces as a failed/restarted deploy instead of running silently half-dead.

> **Free-tier gotcha, and how it's actually handled here:** Render free web services sleep after 15 min with no incoming HTTP traffic. A `setInterval` inside the API process (used here for the sweeper/outbox/slot-generation tick instead of a paid Render Cron Job) stops firing once the instance sleeps — but nothing depends on it for *correctness*: hold expiry is checked lazily in the hold query itself (§4.2), and the tick resumes automatically on the next incoming request that wakes the instance. What it *does* mean: medication reminders and outbox-driven emails can be delayed until something else hits the service. If real-time reminder delivery matters, point an external uptime pinger (e.g. UptimeRobot, free tier) at `/health` every ~10 minutes to keep the instance awake, or move the tick to a real Render Cron Job hitting `POST /internal/tick`.

---

## 3. Data model

### 3.1 Core tables

```sql
-- ── identity ────────────────────────────────────────────────
users(id, email UNIQUE, password_hash, role ENUM(patient,doctor,admin),
      full_name, phone, timezone DEFAULT 'Asia/Kolkata',
      is_active, created_at)

patients(user_id PK→users, dob, gender, blood_group, allergies TEXT[])

doctors(user_id PK→users, specialisation_id→specialisations,
        registration_no, qualification, consultation_fee,
        slot_duration_min INT DEFAULT 30, buffer_min INT DEFAULT 0,
        is_accepting_bookings BOOL)

specialisations(id, name UNIQUE, description)

-- ── availability ────────────────────────────────────────────
doctor_availability(id, doctor_id, weekday SMALLINT,  -- 0=Sun..6=Sat
                    start_time TIME, end_time TIME,
                    valid_from DATE, valid_to DATE NULL)

doctor_leaves(id, doctor_id, start_ts TIMESTAMPTZ, end_ts TIMESTAMPTZ,
              reason, created_by, created_at,
              EXCLUDE USING gist (doctor_id WITH =,
                    tstzrange(start_ts,end_ts) WITH &&))   -- no overlapping leaves

-- ── the critical table ──────────────────────────────────────
slots(id, doctor_id, start_ts TIMESTAMPTZ, end_ts TIMESTAMPTZ,
      status ENUM(available, held, booked, blocked),
      hold_token UUID NULL, hold_expires_at TIMESTAMPTZ NULL,
      held_by_patient_id NULL, version INT DEFAULT 0,
      UNIQUE (doctor_id, start_ts))          -- ← double-booking is impossible

-- ── appointments ────────────────────────────────────────────
appointments(id, slot_id UNIQUE→slots, patient_id, doctor_id,
             status ENUM(scheduled, checked_in, completed,
                         cancelled_by_patient, cancelled_by_clinic, no_show),
             booked_at, cancelled_at, cancellation_reason,
             rescheduled_from_id NULL→appointments,
             idempotency_key UNIQUE NULL)

symptom_submissions(id, appointment_id UNIQUE, raw_symptoms TEXT,
                    duration_days, severity_1_10, existing_conditions TEXT[],
                    current_medications TEXT[], submitted_at)

visit_notes(id, appointment_id UNIQUE, doctor_id,
            clinical_notes TEXT, diagnosis, follow_up_date NULL, created_at)

prescriptions(id, appointment_id UNIQUE, issued_at)
prescription_items(id, prescription_id, drug_name, strength,
                   dose_text, frequency ENUM(OD,BD,TDS,QID,SOS,WEEKLY),
                   timing ENUM(before_food, after_food, any),
                   duration_days, instructions)

-- ── AI ──────────────────────────────────────────────────────
ai_summaries(id, appointment_id, kind ENUM(pre_visit, post_visit),
             status ENUM(pending, ready, failed, degraded),
             urgency ENUM(low, medium, high) NULL,
             chief_complaint TEXT NULL,
             suggested_questions JSONB NULL,
             patient_summary TEXT NULL,
             medication_schedule JSONB NULL,
             follow_up_steps JSONB NULL,
             model, prompt_version, raw_response TEXT,
             input_tokens, output_tokens, latency_ms,
             attempt_count, failure_reason, created_at,
             UNIQUE (appointment_id, kind))

-- ── reminders ───────────────────────────────────────────────
medication_reminders(id, patient_id, prescription_item_id,
                     due_at TIMESTAMPTZ, status ENUM(pending,sent,skipped,failed),
                     sent_at, INDEX (status, due_at))

-- ── reliability ─────────────────────────────────────────────
outbox(id, aggregate_type, aggregate_id, event_type, payload JSONB,
       created_at, published_at NULL, INDEX (published_at, id))

notifications(id, appointment_id NULL, recipient_user_id, channel ENUM(email),
              template_key, dedupe_key UNIQUE, payload JSONB,
              status ENUM(queued, sent, failed, dead),
              attempt_count, last_error, next_retry_at, provider_message_id)

calendar_links(id, appointment_id, user_id, provider ENUM(google),
               external_event_id, calendar_id, sync_state ENUM(pending,synced,failed,deleted),
               last_synced_at, UNIQUE (appointment_id, user_id))

oauth_credentials(user_id, provider, access_token_enc, refresh_token_enc,
                  scope, expires_at, revoked_at NULL)

audit_log(id, actor_user_id, action, resource_type, resource_id,
          ip, user_agent, metadata JSONB, created_at)
```

### 3.2 Why slots are materialised

The naive design stores only `doctor_availability` and derives free slots at query time. It then needs `SELECT ... WHERE NOT EXISTS (overlapping appointment)` followed by an `INSERT` — a classic **check-then-act race**. Under two simultaneous requests, both checks pass and both inserts succeed.

Materialising slots turns the problem into a single-row state transition guarded by `UNIQUE (doctor_id, start_ts)`. Two concurrent bookings for the same slot become two `UPDATE`s on the same row; Postgres serialises them, and the second one sees `status <> 'available'` and updates zero rows.

**Slot generation:** a nightly job (plus an on-demand trigger when a doctor's availability changes) materialises slots for a rolling 60-day horizon from `doctor_availability`, skipping ranges covered by `doctor_leaves`. Generation is idempotent — `INSERT ... ON CONFLICT (doctor_id, start_ts) DO NOTHING`.

---

## 4. The slot hold + booking mechanism

### 4.1 Appointment state machine

```
  [slot: available]
        │ POST /slots/:id/hold
        ▼
  [slot: held]  ── hold_expires_at + 10 min ──▶ [slot: available]   (sweeper)
        │ POST /appointments  (with hold_token + symptom form)
        ▼
  [slot: booked] + appointment: scheduled
        │                    │                    │
   check-in              cancel               no response
        ▼                    ▼                    ▼
   checked_in      cancelled_by_* + slot   no_show
        │            released to available
    doctor submits notes
        ▼
    completed
```

### 4.2 Phase 1 — acquire hold

```sql
UPDATE slots
   SET status = 'held',
       hold_token = $newToken,
       hold_expires_at = now() + interval '10 minutes',
       held_by_patient_id = $patientId,
       version = version + 1
 WHERE id = $slotId
   AND start_ts > now() + interval '30 minutes'          -- no last-minute booking
   AND (
        status = 'available'
        OR (status = 'held' AND hold_expires_at < now()) -- lazily reclaim stale hold
       )
   AND NOT EXISTS (
        SELECT 1 FROM doctor_leaves l
         WHERE l.doctor_id = slots.doctor_id
           AND tstzrange(l.start_ts, l.end_ts) @> slots.start_ts
       )
RETURNING id, hold_token, hold_expires_at;
```

Zero rows returned → `409 SLOT_UNAVAILABLE`, and the API responds with the three nearest alternative slots so the UI can recover gracefully instead of dead-ending.

The `AND (... hold_expires_at < now())` clause means correctness **does not depend on the sweeper job running**. The sweeper is a cleanup optimisation for the availability view, not a correctness requirement — an important property when your cron might be sleeping on a free tier.

### 4.3 Phase 2 — confirm booking

All inside one transaction:

```
BEGIN;
  1. UPDATE slots SET status='booked', hold_token=NULL
      WHERE id=$slotId AND hold_token=$token AND hold_expires_at > now();
     -- 0 rows → 409 HOLD_EXPIRED
  2. INSERT INTO appointments (...) VALUES (...);         -- slot_id is UNIQUE
  3. INSERT INTO symptom_submissions (...);
  4. INSERT INTO ai_summaries (appointment_id, kind='pre_visit', status='pending');
  5. INSERT INTO outbox (event_type='appointment.booked', payload={...});
COMMIT;
```

Response returns in ~50 ms. Email, calendar and LLM work all happen after commit, driven by the outbox.

### 4.4 Three layers of protection

| Layer | Protects against | Mechanism |
|---|---|---|
| L1 — DB constraint | Two confirmed bookings on one slot | `UNIQUE (doctor_id, start_ts)` on `slots` + `UNIQUE slot_id` on `appointments` |
| L2 — Conditional update | Lost-update race between concurrent holds | `UPDATE ... WHERE status='available'` + rowcount check (optimistic, no explicit locks) |
| L3 — Idempotency key | Double-click, client retry, flaky network | `Idempotency-Key` header stored on `appointments`; replay returns the original 201 body |

For the reschedule flow (release old slot + acquire new one atomically), acquire row locks in a **deterministic order** — `SELECT ... FROM slots WHERE id IN (a,b) ORDER BY id FOR UPDATE` — to eliminate deadlocks when two patients swap slots simultaneously.

---

## 5. Doctor leave conflict handling

Marking leave is the one operation that mutates already-confirmed state, so it runs as a single serialised transaction:

```
BEGIN;
  1. SELECT * FROM slots
      WHERE doctor_id=$d AND start_ts <@ tstzrange($from,$to)
      FOR UPDATE;                      -- blocks in-flight holds/bookings on these slots
  2. INSERT INTO doctor_leaves (...);  -- GiST exclusion rejects overlapping leave
  3. UPDATE slots SET status='blocked' WHERE id = ANY(free_or_held_ids);
  4. SELECT affected appointments (status='scheduled') in range;
  5. UPDATE appointments SET status='cancelled_by_clinic',
            cancellation_reason='doctor_leave', cancelled_at=now()
      WHERE id = ANY(affected);
  6. For each affected appointment, INSERT INTO outbox:
       - 'appointment.cancelled_by_clinic'  → email patient (with apology + rebooking link)
       - 'appointment.cancelled_by_clinic'  → email doctor (digest)
       - 'calendar.delete'                  → remove both calendar events
COMMIT;
```

**The race it closes:** patient A confirms a booking at the exact millisecond the admin marks leave. Because step 1 takes `FOR UPDATE` locks on every slot in the range, A's confirm transaction either commits first (and is then caught and cancelled by step 4/5) or blocks until the leave commits (and then fails its own `status='available'` predicate). There is no interleaving where a booking survives inside a leave window.

**Rebooking assistance:** the cancellation email includes a signed, single-use link that pre-filters the search to the same doctor's next three available slots and, failing that, other doctors in the same specialisation. The original `symptom_submission` is carried forward so the patient doesn't retype it, and the existing `ai_summaries` row is re-linked rather than regenerated — saving an LLM call.

**Blocked vs deleted slots:** slots are marked `blocked`, never deleted. When leave is cancelled, they flip back to `available`, and the audit trail of what happened to each slot survives.

---

## 6. LLM integration

### 6.1 Pipeline

```
appointment confirmed
      │
      └─▶ outbox → queue llm.previsit
                        │
             ┌──────────▼───────────┐
             │ 1. PII redaction     │  strip name/phone/email before the API call
             │ 2. Prompt v2 render  │  versioned template from DB
             │ 3. Call with 15s TO  │  temperature 0.2, JSON-only response
             │ 4. Schema validate   │  zod / JSON Schema
             │ 5. Rule-based check  │  red-flag override (see below)
             │ 6. Persist           │  ai_summaries.status = 'ready'
             └──────────────────────┘
```

### 6.2 Prompts

**Pre-visit** (`prompt_version = previsit.v2`), system message:

> You are a clinical triage assistant supporting a licensed physician. You do not diagnose and you do not recommend treatment. Return **only** a JSON object matching the given schema, with no prose or markdown fences. If the symptom text is empty, nonsensical, or not medical in nature, return `urgency: "low"` and set `chief_complaint` to `"insufficient information"`.

User message:

```
Analyse these symptoms and return:
  urgency  — one of "low" | "medium" | "high"
  chief_complaint — one sentence, max 15 words
  suggested_questions — exactly 3 questions the doctor should ask
  red_flags — array of concerning findings, empty if none

Patient context: age {{age}}, sex {{sex}},
  known conditions: {{conditions}}, current medications: {{medications}}
Duration: {{duration_days}} days. Self-rated severity: {{severity}}/10.
Symptoms: {{symptoms}}
```

**Post-visit** (`postvisit.v2`):

```
Convert these clinical notes into a summary a patient with no medical
background can understand. Use simple language, second person, no jargon
(expand any abbreviation on first use). Do not add information that is not
in the notes. Do not change any dose or frequency.

Return JSON: { summary, medication_schedule[{drug, when, how, duration}],
               follow_up_steps[], warning_signs[] }

Clinical notes: {{notes}}
Prescription: {{structured_prescription_json}}
Follow-up date: {{follow_up_date}}
```

### 6.3 Failure handling — a four-level ladder

| Level | Trigger | Behaviour |
|---|---|---|
| **Retry** | Timeout, 429, 5xx | 3 attempts, exponential backoff with jitter (2s / 8s / 30s) |
| **Repair** | Malformed JSON / schema mismatch | One re-prompt with the validation error appended; then give up |
| **Degrade** | All attempts exhausted | `status='degraded'`. Doctor sees the **raw symptom form** verbatim with a "AI summary unavailable" banner. Patient sees the doctor's clinical notes plus the structured prescription table rendered directly from `prescription_items`. |
| **Circuit break** | ≥5 consecutive provider failures | Circuit opens for 60s; jobs are parked, not burned. Half-open probe on recovery, then queued jobs drain automatically. |

Two properties make this safe:

1. **The prescription is never LLM-generated.** `prescription_items` is structured data entered by the doctor. The LLM only rewrites *prose around it*. If the LLM dies, the patient still gets a correct, machine-rendered medication table — and medication reminders keep working, because they're built from `prescription_items`, not from AI output.
2. **Urgency has a deterministic floor.** A keyword rule set (chest pain, breathlessness, severe bleeding, altered consciousness, stroke signs, severity ≥ 9) forces `urgency='high'` regardless of what the model returned, and flags the appointment for clinic review. The LLM can raise urgency but never lower it below the rule floor. This means a hallucinating or unavailable model cannot cause an emergency case to be triaged as routine.

Every call is logged with model, prompt version, tokens, latency and attempt count so prompt changes are measurable rather than vibes-based.

---

## 7. Notification reliability

### 7.1 Transactional outbox

The domain transaction and the intent-to-notify commit together. A relay process polls `outbox WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`, enqueues to BullMQ, and marks rows published. This makes delivery **at-least-once**, which is why every notification carries a `dedupe_key`:

```
dedupe_key = sha256(appointment_id : template_key : scheduled_for)
```

A `UNIQUE` constraint on `dedupe_key` means a duplicate enqueue after a relay crash is a no-op insert, not a duplicate email.

### 7.2 Retry policy

| Failure class | Example | Action |
|---|---|---|
| Transient | 429, 500, socket timeout | Retry at 1m → 5m → 15m → 1h → 6h (5 attempts, jittered) |
| Hard bounce | Invalid mailbox, 550 | Mark `dead` immediately, flag `users.email_valid=false`, surface a banner in the portal |
| Config error | Bad API key | Mark `dead`, page the admin dashboard — retrying will never help |

After 5 attempts a notification moves to `dead` and lands in an **admin dashboard queue** with a manual "resend" action. Nothing fails silently; every state is visible.

### 7.3 In-app as the backstop

Every notification is *also* written as an in-app record. Email is a convenience channel, not the system of record — so a total email-provider outage degrades the experience without losing information. The patient portal shows the same confirmation, cancellation and reminder items.

### 7.4 Notification matrix

| Event | Patient | Doctor | Calendar |
|---|---|---|---|
| Booking confirmed | ✉ confirmation + `.ics` | ✉ new appointment | create both |
| 24h before | ✉ reminder | ✉ daily digest (7am) | — |
| Patient cancels | ✉ acknowledgement | ✉ slot freed | delete both |
| Doctor on leave | ✉ apology + rebook link | ✉ cancellation digest | delete both |
| Reschedule | ✉ new details | ✉ updated | patch both |
| Post-visit summary ready | ✉ summary + prescription | — | — |
| Medication reminder | ✉ per dose | — | — |

---

## 8. Google Calendar integration

**OAuth 2.0 flow:** authorization code + PKCE, `access_type=offline`, `prompt=consent`, scope `calendar.events` only (not full `calendar`). Refresh tokens are encrypted with AES-256-GCM using a KMS-held key before hitting the DB; access tokens are cached in Redis with TTL, never persisted.

**Two events, not one shared event.** Patient and doctor each authorise their own calendar, so the system creates one event per participant and tracks each in `calendar_links`. This avoids depending on the doctor's calendar being shared with patients (a privacy problem) and keeps the two syncs independently retryable.

**Idempotent event creation.** Google lets you supply your own event ID. Using a deterministic one —

```
eventId = base32hex(sha1(appointment_id + user_id)).toLowerCase()
```

— means a retried create returns `409 duplicate` instead of producing a second event. The worker treats `409` as success.

**Lifecycle mapping:**

| Domain action | Calendar API | On failure |
|---|---|---|
| Book | `events.insert` | Retry ×5; then `sync_state='failed'`, email carries `.ics` fallback |
| Reschedule | `events.patch` (start/end) | Same; if 404, fall back to `insert` |
| Cancel | `events.delete` | 404/410 treated as success (already gone) |
| Token revoked | `401 invalid_grant` | Mark credential revoked, prompt re-connect in portal, keep appointments intact |

**Never blocking:** if the patient hasn't connected Google at all, booking still works — they just get an `.ics` attachment. Calendar sync is an enhancement layer with a guaranteed floor, exactly like the LLM.

---

## 9. Medication reminders

When the doctor submits a prescription, the system **materialises** the full reminder schedule rather than computing it on the fly:

```
frequency → local clock times
  OD    → [09:00]
  BD    → [09:00, 21:00]
  TDS   → [08:00, 14:00, 20:00]
  QID   → [08:00, 12:00, 16:00, 20:00]
  WEEKLY→ [same weekday 09:00]
  SOS   → no reminders (as-needed)

for day in 1..duration_days:
  for t in times:
    due_at = (visit_date + day) at t, in patients.timezone → UTC
    INSERT INTO medication_reminders (...)
```

Materialising means a patient can snooze or stop an individual dose, the admin can see exactly what will be sent, and a scheduler restart can't drift.

A cron job every minute runs:

```sql
SELECT * FROM medication_reminders
 WHERE status='pending' AND due_at <= now()
 ORDER BY due_at
 LIMIT 500
 FOR UPDATE SKIP LOCKED;
```

`SKIP LOCKED` allows multiple worker instances to drain the queue in parallel without sending anything twice. Reminders older than 2 hours are marked `skipped` rather than sent — a 3am reminder for an 8am dose is worse than no reminder.

Timezone handling is stored per user and converted at generation time, so DST or a patient relocating doesn't shift an already-scheduled course.

---

## 10. API surface

```
AUTH
  POST   /auth/register                 patient self-signup
  POST   /auth/login                    → access (15m) + refresh (7d, rotating)
  POST   /auth/refresh
  POST   /auth/logout

ADMIN
  POST   /admin/doctors                 create doctor profile + credentials
  PATCH  /admin/doctors/:id
  PUT    /admin/doctors/:id/availability
  POST   /admin/doctors/:id/leaves      → returns { cancelled_appointments: n }
  DELETE /admin/leaves/:id
  GET    /admin/notifications/dead      failed-notification queue
  POST   /admin/notifications/:id/retry

DISCOVERY
  GET    /specialisations
  GET    /doctors?specialisation=&date=&q=
  GET    /doctors/:id/slots?from=&to=   available slots only

BOOKING
  POST   /slots/:id/hold                → { hold_token, expires_at }
  DELETE /holds/:token                  explicit release
  POST   /appointments                  Idempotency-Key required
         body: { hold_token, symptoms{...} }
  GET    /appointments?role=&status=    scoped by JWT role
  GET    /appointments/:id
  POST   /appointments/:id/reschedule   { new_slot_id }
  POST   /appointments/:id/cancel       { reason }

CLINICAL
  GET    /appointments/:id/pre-visit    doctor only → AI summary or raw fallback
  POST   /appointments/:id/notes        { clinical_notes, diagnosis,
                                          prescription_items[], follow_up_date }
  GET    /appointments/:id/post-visit   patient-friendly summary
  GET    /patients/me/medications       active courses + upcoming reminders
  POST   /medications/:id/skip

INTEGRATIONS
  GET    /integrations/google/connect   → OAuth consent redirect
  GET    /integrations/google/callback
  DELETE /integrations/google           revoke + delete stored tokens

INTERNAL (cron-authenticated)
  POST   /internal/tick                 sweep holds, dispatch reminders, generate slots
  GET    /health                        db + redis + queue depth
```

**Conventions:** RFC 7807 problem+json errors, cursor pagination, `ETag` on slot listings, `429` with `Retry-After` on the booking endpoints (10 req/min per user), and every 4xx carries a machine-readable `code` (`SLOT_UNAVAILABLE`, `HOLD_EXPIRED`, `DOCTOR_ON_LEAVE`, `IDEMPOTENCY_CONFLICT`) so the frontend can recover intelligently.

---

## 11. Security & RBAC

| Concern | Control |
|---|---|
| AuthN | Argon2id password hashing, JWT access 15 min, refresh token rotation with reuse detection |
| AuthZ | Route-level role guard **plus** resource-level ownership check — a doctor requesting appointment `X` must be `X.doctor_id`. Never trust an ID from the URL. |
| PHI at rest | `raw_symptoms`, `clinical_notes` encrypted (pgcrypto or app-layer AES-GCM) |
| PII to third parties | Redaction layer strips names/phones/emails before any LLM call |
| Secrets | OAuth refresh tokens encrypted; nothing sensitive in JWT claims |
| Audit | Every read of another user's clinical record writes to `audit_log` |
| Transport | HTTPS only, HSTS, secure + httpOnly + sameSite cookies for refresh token |
| Abuse | Rate limits per IP and per user; account lockout after 10 failed logins |

---

## 12. Failure mode summary

| What breaks | Blast radius | System behaviour |
|---|---|---|
| LLM provider down | Summaries only | Booking, email, calendar all unaffected. Doctor sees raw symptoms; patient sees structured prescription. Jobs replay on recovery. |
| Email provider down | Delivery only | Outbox holds intent; retries over 6h; in-app notifications always present. |
| Google Calendar 5xx | Calendar sync only | Retried; `.ics` fallback in email; appointment unaffected. |
| Redis down | Async work pauses | API stays up (bookings still commit). Outbox rows accumulate and drain on recovery — nothing lost. |
| Worker crash mid-job | One job | BullMQ redelivers; `dedupe_key` and idempotent Calendar IDs prevent duplicates. |
| Two patients, one slot | Nothing | One gets 201, the other gets `409 SLOT_UNAVAILABLE` + alternative slots. |
| Cron sleeps (free tier) | Stale holds visible | Lazy expiry in the hold query keeps correctness; only the availability display lags. |
| DB connection exhaustion | API latency | PgBouncer transaction pooling; short transactions by design (no external calls inside them). |

---

## 13. Suggested repo structure

```
/apps
  /api            NestJS — controllers, services, guards
  /worker         BullMQ processors (llm, email, calendar, reminders, sweeper)
  /web            Next.js — patient / doctor / admin routes
/packages
  /db             Prisma schema + migrations + seed
  /contracts      shared zod schemas & DTOs (single source for FE + BE types)
  /prompts        versioned prompt templates + golden-output tests
/docs
  README.md  .env.example  api.md  schema.md  prompts.md  google-setup.md
  system-design.md          ← the 800-word deliverable
/tests
  concurrency.spec.ts       ← 50 parallel bookings on one slot → exactly 1 success
  leave-conflict.spec.ts    ← booking mid-leave-creation → correctly cancelled
  llm-failure.spec.ts       ← provider mocked to 500 → degraded, booking intact
```

---

## 14. Mapping to the 800-word write-up

The design document asked for four topics. Draw them from these sections:

| Required topic | Source | Key sentence to lead with |
|---|---|---|
| Double-booking prevention | §3.2, §4.2, §4.4 | "Correctness is enforced by a database uniqueness constraint, not application logic." |
| Doctor leave conflict handling | §5 | "Leave creation takes row locks on the affected slots, which serialises it against in-flight bookings." |
| Slot hold mechanism | §4.1–4.3 | "A 10-minute hold decouples symptom entry from slot reservation, with lazy expiry so correctness never depends on the sweeper." |
| Notification failure handling | §7 | "The transactional outbox guarantees at-least-once delivery; `dedupe_key` makes at-least-once safe." |

---

## 15. Build order

1. Auth + RBAC + user/doctor CRUD *(day 1)*
2. Availability + slot generation + slot listing *(day 1–2)*
3. **Hold → confirm flow + concurrency test** — do this before anything cosmetic; it's the highest-scoring piece *(day 2)*
4. Outbox + email worker + booking/cancellation templates *(day 3)*
5. LLM pre-visit with full failure ladder *(day 3–4)*
6. Visit notes + prescription + post-visit summary *(day 4)*
7. Doctor leave + cascade cancellation *(day 5)*
8. Google Calendar OAuth + sync worker *(day 5–6)*
9. Medication reminders *(day 6)*
10. Deploy, README, `.env.example`, system-design write-up *(day 7)*

Steps 3, 5 and 7 are what the evaluation criteria actually reward. Ship them properly even if the UI stays plain.
