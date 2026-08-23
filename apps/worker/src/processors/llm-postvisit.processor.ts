import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { createLlmClient } from '../llm-client';
import { PostVisitLlmResponseSchema } from '@healthcare/contracts';
import {
  POSTVISIT_SYSTEM_PROMPT,
  POSTVISIT_PROMPT_VERSION,
  renderPostvisitUserPrompt,
} from '@healthcare/prompts';

/**
 * LLM post-visit processor.
 * Same failure ladder as pre-visit.
 * The prescription is NEVER LLM-generated — it renders structured data.
 */
export function createLlmPostvisitProcessor(prisma: PrismaClient) {
  const { client, model, provider, extraParams } = createLlmClient();
  console.log(`LLM post-visit processor using provider=${provider} model=${model}`);

  return async (job: Job) => {
    const appointmentId = job.data.aggregateId;

    const summary = await prisma.aiSummary.findFirst({
      where: { appointmentId, kind: 'post_visit', status: 'pending' },
    });
    if (!summary) return;

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        visitNote: true,
        prescription: { include: { items: true } },
      },
    });

    if (!appointment?.visitNote) return;

    const prescriptionJson = appointment.prescription
      ? JSON.stringify(
          appointment.prescription.items.map((i: any) => ({
            drug: i.drugName,
            strength: i.strength,
            dose: i.doseText,
            frequency: i.frequency,
            timing: i.timing,
            duration: `${i.durationDays} days`,
            instructions: i.instructions,
          })),
        )
      : '[]';

    const userPrompt = renderPostvisitUserPrompt({
      notes: appointment.visitNote.clinicalNotes,
      structuredPrescriptionJson: prescriptionJson,
      followUpDate: appointment.visitNote.followUpDate?.toISOString() || null,
    });

    let attemptCount = 0;
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      attemptCount = attempt;

      try {
        const startTime = Date.now();

        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: POSTVISIT_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 4000,
          ...extraParams,
        });

        const latencyMs = Date.now() - startTime;
        const rawResponse = completion.choices[0]?.message?.content || '';

        let parsed: any;
        try {
          parsed = JSON.parse(rawResponse);
        } catch {
          lastError = 'Invalid JSON response';
          continue;
        }

        const validated = PostVisitLlmResponseSchema.safeParse(parsed);
        if (!validated.success) {
          lastError = `Schema validation failed: ${validated.error.message}`;
          continue;
        }

        const data = validated.data;

        await prisma.aiSummary.update({
          where: { id: summary.id },
          data: {
            status: 'ready',
            patientSummary: data.summary,
            medicationSchedule: data.medication_schedule,
            followUpSteps: data.follow_up_steps,
            rawResponse,
            model,
            promptVersion: POSTVISIT_PROMPT_VERSION,
            inputTokens: completion.usage?.prompt_tokens || 0,
            outputTokens: completion.usage?.completion_tokens || 0,
            latencyMs,
            attemptCount,
          },
        });

        // Create notification for patient
        const { createHash } = await import('crypto');
        const dedupeKey = createHash('sha256')
          .update(`${appointmentId}:post_visit_ready:patient`)
          .digest('hex');

        await prisma.notification.create({
          data: {
            appointmentId,
            recipientUserId: appointment.patientId,
            channel: 'email',
            templateKey: 'post_visit_ready',
            dedupeKey,
            payload: { appointmentId },
          },
        });

        console.log(`Post-visit summary ready for appointment ${appointmentId}`);
        return;
      } catch (error: any) {
        lastError = error.message || 'Unknown error';

        if (error.status === 429) {
          const retryAfter = error.headers?.['retry-after'] || '5';
          await new Promise((r) => setTimeout(r, parseInt(retryAfter, 10) * 1000));
          continue;
        }

        // Permanent errors — retrying can never succeed, degrade immediately.
        if (error.status === 401 || error.status === 403 || error.status === 404) {
          break;
        }

        // Everything else (5xx, network errors, transient 400s) is worth
        // a retry with backoff rather than an instant degrade.
        const baseDelay = [2000, 8000, 30000][attempt - 1] ?? 30000;
        const jitter = Math.random() * baseDelay * 0.3;
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
        continue;
      }
    }

    // Degrade
    await prisma.aiSummary.update({
      where: { id: summary.id },
      data: {
        status: 'degraded',
        failureReason: lastError,
        attemptCount,
        model,
        promptVersion: POSTVISIT_PROMPT_VERSION,
      },
    });

    console.warn(`Post-visit summary DEGRADED for appointment ${appointmentId}: ${lastError}`);
  };
}
