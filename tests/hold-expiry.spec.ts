/**
 * hold-expiry.spec.ts
 *
 * Confirm with an expired hold → 409 HOLD_EXPIRED, slot returns to available.
 *
 * Tests the lazy expiry mechanism: the hold_expires_at check in the confirm
 * query means correctness doesn't depend on the sweeper cron running.
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

describe('Hold expiry', () => {
  let slotId: string;
  let doctorId: string;

  beforeAll(async () => {
    const doctor = await getTestDoctor();
    if (!doctor) throw new Error('No test doctor found — run seed first');
    doctorId = doctor.id;
  });

  afterAll(cleanup);

  it('confirm with expired hold returns 409 HOLD_EXPIRED', async () => {
    // Create a fresh slot
    const slot = await createTestSlot(doctorId);
    slotId = slot.slotId;

    // Get a patient token
    const patient = await createTestPatient(`hold-expiry-${Date.now()}`);

    // Hold the slot
    const holdResult = await apiRequest('POST', `/slots/${slotId}/hold`, {
      token: patient.token,
    });
    expect(holdResult.status).toBe(201);

    const holdToken = holdResult.body.holdToken;

    // Manually expire the hold by setting hold_expires_at to the past
    await prisma.$executeRaw`
      UPDATE slots
         SET hold_expires_at = now() - interval '1 minute'
       WHERE id = ${slotId}::uuid
    `;

    // Try to confirm — should get 409 HOLD_EXPIRED
    const confirmResult = await apiRequest('POST', '/appointments', {
      token: patient.token,
      headers: { 'Idempotency-Key': uuidv4() },
      body: {
        holdToken,
        symptoms: {
          rawSymptoms: 'Test symptoms',
          durationDays: 1,
          severity: 3,
        },
      },
    });

    expect(confirmResult.status).toBe(409);
    expect(confirmResult.body.code).toBe('HOLD_EXPIRED');

    // Verify the slot can be re-held by another patient (lazy reclaim)
    const patient2 = await createTestPatient(`hold-expiry-2-${Date.now()}`);
    const reHoldResult = await apiRequest('POST', `/slots/${slotId}/hold`, {
      token: patient2.token,
    });

    // The lazy expiry clause should reclaim the slot
    expect(reHoldResult.status).toBe(201);
    expect(reHoldResult.body.holdToken).toBeDefined();
  });
});
