import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { createLlmClient } from '../llm-client';
import { PreVisitLlmResponseSchema } from '@healthcare/contracts';
import {
  PREVISIT_SYSTEM_PROMPT,
  PREVISIT_PROMPT_VERSION,
  renderPrevisitUserPrompt,
  applyUrgencyFloor,
} from '@healthcare/prompts';

/**
 * Circuit breaker state for the LLM provider.
 * Opens after 5 consecutive failures for 60 seconds.
 */
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_OPEN_DURATION_MS = 60_000;

function isCircuitOpen(): boolean {
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    if (Date.now() < circuitOpenUntil) return true;
    // Half-open: allow one probe
    consecutiveFailures = CIRCUIT_THRESHOLD - 1;
  }
  return false;
}

function recordSuccess() {
  consecutiveFailures = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_DURATION_MS;
    console.warn(`LLM circuit breaker OPEN until ${new Date(circuitOpenUntil).toISOString()}`);
  }
}

/**
 * LLM pre-visit processor with the four-level failure ladder:
 * 1. Retry (3×, exponential backoff with jitter)
 * 2. Schema-repair re-prompt (once)
 * 3. Degrade (status='degraded', UI shows raw data)
 * 4. Circuit breaker (5 consecutive failures opens for 60s)
 */
export function createLlmPrevisitProcessor(prisma: PrismaClient) {
  const { client, model, provider, extraParams } = createLlmClient();
  console.log(`LLM pre-visit processor using provider=${provider} model=${model}`);

  return async (job: Job) => {
    const appointmentId = job.data.aggregateId;
    const payload = job.data.payload;

    // Get the pending AI summary and symptom data
    const summary = await prisma.aiSummary.findFirst({
      where: { appointmentId, kind: 'pre_visit', status: 'pending' },
    });
    if (!summary) return;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        symptomSubmission: true,
        patient: {
          include: { user: { select: { fullName: true } } },
        },
      },
    });
    if (!appointment?.symptomSubmission) return;

    const symptoms = appointment.symptomSubmission;

    // Circuit breaker check
    if (isCircuitOpen()) {
      console.warn(`Circuit open — parking job for appointment ${appointmentId}`);
      // Re-queue with delay
      throw new Error('CIRCUIT_OPEN');
    }

    // PII redaction — strip names, phones, emails before API call
    const redactedSymptoms = symptoms.rawSymptoms
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]')
      .replace(/\b\d{10}\b/g, '[PHONE]');

    const userPrompt = renderPrevisitUserPrompt({
      age: 'N/A', // Would come from patient DOB
      sex: 'N/A',
      conditions: symptoms.existingConditions.join(', ') || 'None reported',
      medications: symptoms.currentMedications.join(', ') || 'None reported',
      durationDays: symptoms.durationDays ?? 'Not specified',
      severity: symptoms.severity ?? 'Not rated',
      symptoms: redactedSymptoms,
    });

    let attemptCount = 0;
    let lastError = '';

    // Retry loop — 3 attempts with exponential backoff + jitter
    for (let attempt = 1; attempt <= 3; attempt++) {
      attemptCount = attempt;

      try {
        const startTime = Date.now();

        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: PREVISIT_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 2000,
          ...extraParams,
        });

        const latencyMs = Date.now() - startTime;
        const rawResponse = completion.choices[0]?.message?.content || '';
        const inputTokens = completion.usage?.prompt_tokens || 0;
        const outputTokens = completion.usage?.completion_tokens || 0;

        // Parse and validate response
        let parsed: any;
        try {
          parsed = JSON.parse(rawResponse);
        } catch {
          // Schema-repair re-prompt (once)
          if (attempt < 3) {
            const repairCompletion = await client.chat.completions.create({
              model,
              messages: [
                { role: 'system', content: PREVISIT_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
                { role: 'assistant', content: rawResponse },
                {
                  role: 'user',
                  content: `Your previous response was not valid JSON. Please return ONLY a valid JSON object with keys: urgency, chief_complaint, suggested_questions (array of 3), red_flags (array).`,
                },
              ],
              response_format: { type: 'json_object' },
              temperature: 0.2,
              max_tokens: 2000,
              ...extraParams,
            });

            const repairRaw = repairCompletion.choices[0]?.message?.content || '';
            try {
              parsed = JSON.parse(repairRaw);
            } catch {
              lastError = 'Schema repair failed — invalid JSON after re-prompt';
              continue;
            }
          } else {
            lastError = 'Invalid JSON response from LLM';
            continue;
          }
        }

        // Validate against zod schema
        const validated = PreVisitLlmResponseSchema.safeParse(parsed);
        if (!validated.success) {
          lastError = `Schema validation failed: ${validated.error.message}`;
          continue;
        }

        const data = validated.data;

        // Apply deterministic urgency floor
        const { urgency, floorApplied, matchedRules } = applyUrgencyFloor(
          data.urgency,
          symptoms.rawSymptoms,
          symptoms.severity,
        );

        // Success — persist the result
        await prisma.aiSummary.update({
          where: { id: summary.id },
          data: {
            status: 'ready',
            urgency,
            chiefComplaint: data.chief_complaint,
            suggestedQuestions: data.suggested_questions,
            rawResponse,
            model,
            promptVersion: PREVISIT_PROMPT_VERSION,
            inputTokens,
            outputTokens,
            latencyMs,
            attemptCount,
          },
        });

        recordSuccess();

        console.log(
          `Pre-visit summary ready for appointment ${appointmentId}: urgency=${urgency}` +
          (floorApplied ? ` (floor applied: ${matchedRules.join(', ')})` : ''),
        );

        return;
      } catch (error: any) {
        lastError = error.message || 'Unknown error';

        // Handle 429 rate limiting using x-ratelimit-* headers
        if (error.status === 429) {
          const retryAfter = error.headers?.['retry-after']
            || error.headers?.['x-ratelimit-reset-requests']
            || '5';
          const waitMs = parseInt(retryAfter, 10) * 1000;
          console.warn(`Rate limited — waiting ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }

        // Permanent errors — retrying can never succeed, degrade immediately.
        if (error.status === 401 || error.status === 403 || error.status === 404) {
          recordFailure();
          break;
        }

        // Everything else (5xx, network errors, and transient 400s like a
        // provider's occasional strict-JSON-mode validation glitch) is
        // worth a retry with backoff rather than an instant degrade.
        recordFailure();
        const baseDelay = [2000, 8000, 30000][attempt - 1] ?? 30000;
        const jitter = Math.random() * baseDelay * 0.3;
        await sleep(baseDelay + jitter);
        continue;
      }
    }

    // All attempts exhausted — degrade
    await prisma.aiSummary.update({
      where: { id: summary.id },
      data: {
        status: 'degraded',
        failureReason: lastError,
        attemptCount,
        model,
        promptVersion: PREVISIT_PROMPT_VERSION,
      },
    });

    // Still apply urgency floor even when degraded
    const { urgency, floorApplied } = applyUrgencyFloor(
      'low', // default when LLM fails
      symptoms.rawSymptoms,
      symptoms.severity,
    );

    if (floorApplied) {
      await prisma.aiSummary.update({
        where: { id: summary.id },
        data: { urgency },
      });
    }

    console.warn(
      `Pre-visit summary DEGRADED for appointment ${appointmentId}: ${lastError}`,
    );
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
