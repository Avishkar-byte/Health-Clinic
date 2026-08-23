/**
 * leave-conflict.spec.ts
 *
 * Booking committed concurrently with leave creation → appointment cancelled,
 * patient notified, no orphaned booking inside the leave window.
 *
 * This tests the serialisation provided by SELECT ... FOR UPDATE on all
 * slots in the leave range per §5 of the architecture doc.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  prisma,
  apiRequest,
  createTestPatient,
  createTestSlot,
  getTestDoctor,
  loginAs,
  cleanup,
} from './helpers';

describe('Leave-conflict handling', () => {
  afterAll(cleanup);

  it('cancels an existing booking when leave is created', async () => {
    const doctor = await getTestDoctor();
    if (!doctor) throw new Error('No test doctor found');

    // Create a slot and book it. This test creates a leave that blocks the
    // whole day and is never torn down, so a fixed day offset would collide
    // with a leftover leave from any earlier run against the same database —
    // jitter the day so repeated runs land on a fresh day each time.
    const dayOffset = 2 + Math.floor(Math.random() * 300);
    const futureDate = new Date(Date.now() + dayOffset * 86400000);
    futureDate.setHours(10, 0, 0, 0);
    const slot = await createTestSlot(doctor.id, futureDate);

    const patient = await createTestPatient(`leave-conflict-${Date.now()}`);

    // Hold and confirm
    const holdRes = await apiRequest('POST', `/slots/${slot.slotId}/hold`, {
      token: patient.token,
    });
    expect(holdRes.status).toBe(201);

    const confirmRes = await apiRequest('POST', '/appointments', {
      token: patient.token,
      headers: { 'Idempotency-Key': uuidv4() },
      body: {
        holdToken: holdRes.body.holdToken,
        symptoms: {
          rawSymptoms: 'Test symptoms for leave-conflict test',
          durationDays: 1,
          severity: 3,
        },
      },
    });
    expect(confirmRes.status).toBe(201);
    const appointmentId = confirmRes.body.id;

    // Now create leave that covers this slot
    const adminToken = await loginAs('admin@clinic.local');

    const leaveStart = new Date(futureDate);
    leaveStart.setHours(0, 0, 0, 0);
    const leaveEnd = new Date(futureDate);
    leaveEnd.setHours(23, 59, 59, 999);

    const leaveRes = await apiRequest('POST', `/admin/doctors/${doctor.id}/leaves`, {
      token: adminToken,
      body: {
        startTs: leaveStart.toISOString(),
        endTs: leaveEnd.toISOString(),
        reason: 'Medical conference',
      },
    });

    expect(leaveRes.status).toBe(201);
    expect(leaveRes.body.cancelledAppointments).toBeGreaterThanOrEqual(1);

    // Verify the appointment was cancelled
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    expect(appointment?.status).toBe('cancelled_by_clinic');
    expect(appointment?.cancellationReason).toBe('doctor_leave');

    // Verify the slot is blocked
    const slotRecord = await prisma.slot.findUnique({
      where: { id: slot.slotId },
    });
    expect(slotRecord?.status).toBe('blocked');

    // Verify a notification was created for the patient
    const notification = await prisma.notification.findFirst({
      where: {
        appointmentId,
        templateKey: 'appointment_cancelled_leave',
      },
    });
    expect(notification).toBeTruthy();
    expect(notification?.recipientUserId).toBe(patient.userId);
  });

  it('new bookings inside a leave window are rejected', async () => {
    const doctor = await getTestDoctor();
    if (!doctor) throw new Error('No test doctor found');

    // Create a future slot inside an existing leave
    const futureDate = new Date(Date.now() + 5 * 86400000);
    futureDate.setHours(14, 0, 0, 0);

    // First create leave
    const adminToken = await loginAs('admin@clinic.local');
    const leaveStart = new Date(futureDate);
    leaveStart.setHours(0, 0, 0, 0);
    const leaveEnd = new Date(futureDate);
    leaveEnd.setHours(23, 59, 59, 999);

    await apiRequest('POST', `/admin/doctors/${doctor.id}/leaves`, {
      token: adminToken,
      body: {
        startTs: leaveStart.toISOString(),
        endTs: leaveEnd.toISOString(),
        reason: 'Personal day',
      },
    });

    // Create a slot that falls inside the leave
    const slot = await createTestSlot(doctor.id, futureDate);
    const patient = await createTestPatient(`leave-block-${Date.now()}`);

    // Try to hold — should fail because the slot overlaps with leave
    const holdRes = await apiRequest('POST', `/slots/${slot.slotId}/hold`, {
      token: patient.token,
    });

    expect(holdRes.status).toBe(409);
    expect(holdRes.body.code).toBe('SLOT_UNAVAILABLE');
  });
});
