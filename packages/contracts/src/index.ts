import { z } from 'zod';

export { encryptSecret, decryptSecret } from './crypto';

// ── Auth ────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(200),
  phone: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string(),
});

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
    role: z.enum(['patient', 'doctor', 'admin']),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Users ───────────────────────────────────────────────────

export const CreateDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(200),
  phone: z.string().optional(),
  specialisationId: z.string().uuid(),
  registrationNo: z.string().min(1),
  qualification: z.string().min(1),
  consultationFee: z.number().int().min(0).default(0),
  slotDurationMin: z.number().int().min(10).max(120).default(30),
  bufferMin: z.number().int().min(0).max(60).default(0),
});
export type CreateDoctorDto = z.infer<typeof CreateDoctorSchema>;

export const UpdateDoctorSchema = CreateDoctorSchema.partial().omit({
  email: true,
  password: true,
});
export type UpdateDoctorDto = z.infer<typeof UpdateDoctorSchema>;

// ── Slots ───────────────────────────────────────────────────

export const SlotStatusEnum = z.enum(['available', 'held', 'booked', 'blocked']);
export type SlotStatusType = z.infer<typeof SlotStatusEnum>;

export const SlotResponseSchema = z.object({
  id: z.string().uuid(),
  doctorId: z.string().uuid(),
  startTs: z.string().datetime(),
  endTs: z.string().datetime(),
  status: SlotStatusEnum,
  holdExpiresAt: z.string().datetime().nullable().optional(),
});
export type SlotResponse = z.infer<typeof SlotResponseSchema>;

export const HoldResponseSchema = z.object({
  slotId: z.string().uuid(),
  holdToken: z.string().uuid(),
  expiresAt: z.string().datetime(),
  slot: SlotResponseSchema,
});
export type HoldResponse = z.infer<typeof HoldResponseSchema>;

export const SlotQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ── Availability ────────────────────────────────────────────

export const AvailabilitySlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  validFrom: z.string(),
  validTo: z.string().nullable().optional(),
});

export const SetAvailabilitySchema = z.object({
  slots: z.array(AvailabilitySlotSchema).min(1),
});
export type SetAvailabilityDto = z.infer<typeof SetAvailabilitySchema>;

// ── Appointments ────────────────────────────────────────────

export const AppointmentStatusEnum = z.enum([
  'scheduled', 'checked_in', 'completed',
  'cancelled_by_patient', 'cancelled_by_clinic', 'no_show',
]);

export const SymptomSubmissionSchema = z.object({
  rawSymptoms: z.string().min(1).max(5000),
  durationDays: z.number().int().min(0).max(3650).optional(),
  severity: z.number().int().min(1).max(10).optional(),
  existingConditions: z.array(z.string()).default([]),
  currentMedications: z.array(z.string()).default([]),
  additionalNotes: z.string().max(2000).optional(),
});
export type SymptomSubmissionDto = z.infer<typeof SymptomSubmissionSchema>;

export const CreateAppointmentSchema = z.object({
  holdToken: z.string().uuid(),
  symptoms: SymptomSubmissionSchema,
});
export type CreateAppointmentDto = z.infer<typeof CreateAppointmentSchema>;

export const CancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const RescheduleAppointmentSchema = z.object({
  newSlotId: z.string().uuid(),
});

// ── Leave ───────────────────────────────────────────────────

export const CreateLeaveSchema = z.object({
  startTs: z.string().datetime(),
  endTs: z.string().datetime(),
  reason: z.string().max(500).optional(),
});
export type CreateLeaveDto = z.infer<typeof CreateLeaveSchema>;

export const LeaveBlastRadiusSchema = z.object({
  cancelledAppointments: z.number().int(),
  affectedPatients: z.array(z.object({
    patientName: z.string(),
    appointmentTime: z.string().datetime(),
    appointmentId: z.string().uuid(),
  })),
});

// ── Clinical ────────────────────────────────────────────────

export const FrequencyEnum = z.enum(['OD', 'BD', 'TDS', 'QID', 'SOS', 'WEEKLY']);
export type FrequencyType = z.infer<typeof FrequencyEnum>;

export const MealTimingEnum = z.enum(['before_food', 'after_food', 'any']);

export const PrescriptionItemSchema = z.object({
  drugName: z.string().min(1),
  strength: z.string().min(1),
  doseText: z.string().min(1),
  frequency: FrequencyEnum,
  timing: MealTimingEnum,
  durationDays: z.number().int().min(1).max(365),
  instructions: z.string().optional(),
});
export type PrescriptionItemDto = z.infer<typeof PrescriptionItemSchema>;

export const VisitNoteSchema = z.object({
  clinicalNotes: z.string().min(1).max(10000),
  diagnosis: z.string().min(1).max(2000),
  followUpDate: z.string().nullable().optional(),
  prescriptionItems: z.array(PrescriptionItemSchema).default([]),
});
export type VisitNoteDto = z.infer<typeof VisitNoteSchema>;

// ── Reminder Schedule Computation (shared FE + BE) ──────────

export const FREQUENCY_TIMES: Record<string, string[]> = {
  OD:     ['09:00'],
  BD:     ['09:00', '21:00'],
  TDS:    ['08:00', '14:00', '20:00'],
  QID:    ['08:00', '12:00', '16:00', '20:00'],
  WEEKLY: ['09:00'],
  SOS:    [], // as-needed, no scheduled reminders
};

export interface ReminderPreview {
  totalReminders: number;
  times: string[];
  startDate: string;
  endDate: string;
  description: string;
}

/**
 * Compute a preview of the reminder schedule for a prescription item.
 * This function is shared between frontend (live preview) and backend (materialisation).
 */
export function computeReminderSchedule(
  frequency: FrequencyType,
  durationDays: number,
  startDate: Date,
): ReminderPreview {
  const times = FREQUENCY_TIMES[frequency] ?? [];
  if (times.length === 0) {
    return {
      totalReminders: 0,
      times: [],
      startDate: startDate.toISOString().split('T')[0]!,
      endDate: startDate.toISOString().split('T')[0]!,
      description: 'As needed — no scheduled reminders',
    };
  }

  let effectiveDays = durationDays;
  if (frequency === 'WEEKLY') {
    effectiveDays = Math.ceil(durationDays / 7);
  }

  const totalReminders = effectiveDays * times.length;
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + durationDays - 1);

  const timeStr = times.join(' and ');
  const startStr = startDate.toISOString().split('T')[0]!;
  const endStr = endDate.toISOString().split('T')[0]!;

  const description =
    frequency === 'WEEKLY'
      ? `${totalReminders} reminders: ${timeStr}, weekly for ${durationDays} days`
      : `${totalReminders} reminders: ${timeStr}, ${startStr} – ${endStr}`;

  return {
    totalReminders,
    times,
    startDate: startStr,
    endDate: endStr,
    description,
  };
}

// ── LLM Schemas ─────────────────────────────────────────────

export const PreVisitLlmResponseSchema = z.object({
  urgency: z.enum(['low', 'medium', 'high']),
  chief_complaint: z.string(),
  suggested_questions: z.array(z.string()).length(3),
  red_flags: z.array(z.string()),
});
export type PreVisitLlmResponse = z.infer<typeof PreVisitLlmResponseSchema>;

export const PostVisitLlmResponseSchema = z.object({
  summary: z.string(),
  medication_schedule: z.array(z.object({
    drug: z.string(),
    when: z.string(),
    how: z.string(),
    duration: z.string(),
  })),
  follow_up_steps: z.array(z.string()),
  warning_signs: z.array(z.string()),
});
export type PostVisitLlmResponse = z.infer<typeof PostVisitLlmResponseSchema>;

// ── Notifications ───────────────────────────────────────────

export const NotificationStatusEnum = z.enum(['queued', 'sent', 'failed', 'dead']);

// ── Error Codes ─────────────────────────────────────────────

export const ERROR_CODES = {
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  DOCTOR_ON_LEAVE: 'DOCTOR_ON_LEAVE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

// ── RFC 7807 Problem ────────────────────────────────────────

export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  code: z.string().optional(),
  instance: z.string().optional(),
});
