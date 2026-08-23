import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { VisitNoteDto } from '@healthcare/contracts';
import { FREQUENCY_TIMES } from '@healthcare/contracts';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ClinicalService {
  private readonly logger = new Logger(ClinicalService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /appointments/:id/pre-visit — doctor only.
   * Returns the AI summary if ready, or the raw symptom form as fallback.
   */
  async getPreVisitSummary(appointmentId: string, doctorId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        symptomSubmission: true,
        aiSummaries: { where: { kind: 'pre_visit' } },
        patient: {
          include: {
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!appointment || appointment.doctorId !== doctorId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    const summary = appointment.aiSummaries[0];
    const symptoms = appointment.symptomSubmission;

    return {
      appointmentId,
      patientName: appointment.patient?.user?.fullName,
      summary: summary
        ? {
            status: summary.status,
            urgency: summary.urgency,
            chiefComplaint: summary.chiefComplaint,
            suggestedQuestions: summary.suggestedQuestions,
            redFlags: summary.rawResponse
              ? (() => { try { return JSON.parse(summary.rawResponse)?.red_flags; } catch { return []; } })()
              : [],
          }
        : null,
      // Always include raw symptoms as fallback
      symptoms: symptoms
        ? {
            rawSymptoms: symptoms.rawSymptoms,
            durationDays: symptoms.durationDays,
            severity: symptoms.severity,
            existingConditions: symptoms.existingConditions,
            currentMedications: symptoms.currentMedications,
            additionalNotes: symptoms.additionalNotes,
          }
        : null,
    };
  }

  /**
   * POST /appointments/:id/notes — doctor submits visit notes + prescription.
   * This triggers:
   * - Visit note creation
   * - Prescription + items creation
   * - Medication reminder materialisation
   * - Post-visit LLM summary (outbox event)
   * - Appointment status → completed
   */
  async submitVisitNotes(appointmentId: string, doctorId: string, dto: VisitNoteDto) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true },
    });

    if (!appointment || appointment.doctorId !== doctorId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    if (!['scheduled', 'checked_in'].includes(appointment.status)) {
      throw new BadRequestException({
        code: 'INVALID_STATE',
        title: 'Cannot submit notes',
        detail: 'Visit notes can only be submitted for scheduled or checked-in appointments.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Update appointment status
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: 'completed' },
      });

      // Create visit note
      const visitNote = await tx.visitNote.create({
        data: {
          appointmentId,
          doctorId,
          clinicalNotes: dto.clinicalNotes,
          diagnosis: dto.diagnosis,
          followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
        },
      });

      let prescription = null;

      // Create prescription if items provided
      if (dto.prescriptionItems && dto.prescriptionItems.length > 0) {
        prescription = await tx.prescription.create({
          data: {
            appointmentId,
            items: {
              create: dto.prescriptionItems.map((item) => ({
                drugName: item.drugName,
                strength: item.strength,
                doseText: item.doseText,
                frequency: item.frequency,
                timing: item.timing,
                durationDays: item.durationDays,
                instructions: item.instructions,
              })),
            },
          },
          include: { items: true },
        });

        // Materialise medication reminders
        const patientTimezone = appointment.patient?.dob
          ? 'Asia/Kolkata'
          : 'Asia/Kolkata'; // Use patient's timezone

        for (const item of prescription.items) {
          if (item.frequency === 'SOS') continue; // No reminders for as-needed

          const times = FREQUENCY_TIMES[item.frequency] || [];
          const startDate = new Date();
          startDate.setDate(startDate.getDate() + 1); // Start from next day

          for (let day = 0; day < item.durationDays; day++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(currentDate.getDate() + day);

            if (item.frequency === 'WEEKLY' && day % 7 !== 0) continue;

            for (const time of times) {
              const [hours, minutes] = time.split(':').map(Number);
              const dueAt = new Date(currentDate);
              dueAt.setHours(hours ?? 0, minutes ?? 0, 0, 0);

              await tx.medicationReminder.create({
                data: {
                  patientId: appointment.patientId,
                  prescriptionItemId: item.id,
                  dueAt,
                  status: 'pending',
                },
              });
            }
          }
        }
      }

      // Insert pending post-visit AI summary
      await tx.aiSummary.create({
        data: {
          appointmentId,
          kind: 'post_visit',
          status: 'pending',
        },
      });

      // Outbox event for post-visit LLM + notification
      await tx.outbox.create({
        data: {
          aggregateType: 'appointment',
          aggregateId: appointmentId,
          eventType: 'notes.submitted',
          payload: {
            appointmentId,
            patientId: appointment.patientId,
            doctorId,
          },
        },
      });

      return { visitNote, prescription };
    });

    return result;
  }

  /**
   * GET /appointments/:id/post-visit — patient-friendly summary.
   * Falls back to structured prescription data if LLM is degraded.
   */
  async getPostVisitSummary(appointmentId: string, patientId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        aiSummaries: { where: { kind: 'post_visit' } },
        visitNote: true,
        prescription: { include: { items: true } },
        doctor: {
          include: {
            user: { select: { fullName: true } },
            specialisation: true,
          },
        },
      },
    });

    if (!appointment || appointment.patientId !== patientId) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Appointment not found' });
    }

    const summary = appointment.aiSummaries[0];

    return {
      appointmentId,
      doctorName: appointment.doctor?.user?.fullName,
      specialisation: appointment.doctor?.specialisation?.name,
      summary: summary
        ? {
            status: summary.status,
            patientSummary: summary.patientSummary,
            medicationSchedule: summary.medicationSchedule,
            followUpSteps: summary.followUpSteps,
          }
        : null,
      // Always include the structured prescription — this is never LLM-generated
      visitNote: appointment.visitNote
        ? {
            diagnosis: appointment.visitNote.diagnosis,
            clinicalNotes: appointment.visitNote.clinicalNotes,
            followUpDate: appointment.visitNote.followUpDate,
          }
        : null,
      prescription: appointment.prescription
        ? {
            items: appointment.prescription.items.map((item) => ({
              drugName: item.drugName,
              strength: item.strength,
              doseText: item.doseText,
              frequency: item.frequency,
              timing: item.timing,
              durationDays: item.durationDays,
              instructions: item.instructions,
            })),
          }
        : null,
    };
  }

  /**
   * GET /patients/me/medications — active courses + upcoming reminders.
   */
  async getPatientMedications(patientId: string) {
    const reminders = await this.prisma.medicationReminder.findMany({
      where: {
        patientId,
        status: 'pending',
        dueAt: { gte: new Date() },
      },
      include: {
        prescriptionItem: true,
      },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });

    return reminders.map((r) => ({
      id: r.id,
      drugName: r.prescriptionItem.drugName,
      strength: r.prescriptionItem.strength,
      doseText: r.prescriptionItem.doseText,
      frequency: r.prescriptionItem.frequency,
      timing: r.prescriptionItem.timing,
      dueAt: r.dueAt,
      status: r.status,
    }));
  }
}
