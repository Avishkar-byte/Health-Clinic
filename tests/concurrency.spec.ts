/**
 * concurrency.spec.ts
 *
 * 50 parallel POST /appointments on one slot → exactly 1 × 201, 49 × 409
 *
 * This is the strongest demonstration that the double-booking prevention design works.
 * The UNIQUE (doctor_id, start_ts) constraint on the slots table, combined with the
 * conditional UPDATE WHERE status='available', means exactly one hold wins.
 */
import { v4 as uuidv4 } from 'uuid';
import {
  prisma,
  apiRequest,
  createTestPatient,
  createTestSlot,
  getTestDoctor,
  cleanup,
} from './helpers';

describe('Concurrency — 50 parallel bookings on one slot', () => {
  let slotId: string;
  let doctorId: string;

  beforeAll(async () => {
    const doctor = await getTestDoctor();
    if (!doctor) throw new Error('No test doctor found — run seed first');
    doctorId = doctor.id;

    // Create a fresh available slot
    const slot = await createTestSlot(doctorId);
    slotId = slot.slotId;
  });

  afterAll(cleanup);

  it('exactly 1 booking succeeds, 49 get 409', async () => {
    // Create 50 patients with tokens
    const patients = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        createTestPatient(`concurrency-${i}-${Date.now()}`),
      ),
    );

    // Each patient tries to hold the same slot
    const holdResults = await Promise.all(
      patients.map((p) =>
        apiRequest('POST', `/slots/${slotId}/hold`, { token: p.token }),
      ),
    );

    // Exactly one hold should succeed
    const successfulHolds = holdResults.filter((r) => r.status === 200 || r.status === 201);
    const failedHolds = holdResults.filter((r) => r.status === 409);

    expect(successfulHolds.length).toBe(1);
    expect(failedHolds.length).toBe(49);

    // The successful hold should have a hold_token
    const winner = successfulHolds[0]!;
    expect(winner.body.holdToken).toBeDefined();

    // The failed holds should include alternatives
    for (const failed of failedHolds) {
      expect(failed.body.code).toBe('SLOT_UNAVAILABLE');
    }

    // Now confirm the booking with the winner
    const winnerPatient = patients[holdResults.indexOf(winner)]!;
    const idempotencyKey = uuidv4();

    const confirmResult = await apiRequest('POST', '/appointments', {
      token: winnerPatient.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        holdToken: winner.body.holdToken,
        symptoms: {
          rawSymptoms: 'Test symptoms for concurrency test',
          durationDays: 1,
          severity: 3,
        },
      },
    });

    expect(confirmResult.status).toBe(201);
    expect(confirmResult.body.id).toBeDefined();

    // Verify only one appointment exists for this slot
    const appointments = await prisma.appointment.findMany({
      where: { slotId },
    });
    expect(appointments.length).toBe(1);
  });
});
