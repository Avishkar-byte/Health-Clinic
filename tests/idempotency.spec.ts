/**
 * idempotency.spec.ts
 *
 * Same Idempotency-Key twice → one appointment, identical response body.
 *
 * Layer 3 protection from §4.4: prevents double-click, client retry,
 * and flaky network from creating duplicate bookings.
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

describe('Idempotency key', () => {
  afterAll(cleanup);

  it('replaying the same key returns the original response', async () => {
    const doctor = await getTestDoctor();
    if (!doctor) throw new Error('No test doctor found');

    const slot = await createTestSlot(doctor.id);
    const patient = await createTestPatient(`idempotency-${Date.now()}`);

    // Hold the slot
    const holdResult = await apiRequest('POST', `/slots/${slot.slotId}/hold`, {
      token: patient.token,
    });
    expect(holdResult.status).toBe(201);

    const idempotencyKey = uuidv4();
    const body = {
      holdToken: holdResult.body.holdToken,
      symptoms: {
        rawSymptoms: 'Test symptoms for idempotency test',
        durationDays: 2,
        severity: 4,
      },
    };

    // First request — creates the appointment
    const res1 = await apiRequest('POST', '/appointments', {
      token: patient.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
    });
    expect(res1.status).toBe(201);
    expect(res1.body.id).toBeDefined();

    // Second request with same key — returns the original
    const res2 = await apiRequest('POST', '/appointments', {
      token: patient.token,
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
    });

    // Should return the same appointment
    expect(res2.body.id).toBe(res1.body.id);
    expect(res2.body.slotId).toBe(res1.body.slotId);
    expect(res2.body.patientId).toBe(res1.body.patientId);

    // Verify only one appointment was created
    const count = await prisma.appointment.count({
      where: { idempotencyKey },
    });
    expect(count).toBe(1);
  });

  it('rejects request without Idempotency-Key', async () => {
    const patient = await createTestPatient(`idempotency-nokey-${Date.now()}`);

    const res = await apiRequest('POST', '/appointments', {
      token: patient.token,
      body: {
        holdToken: uuidv4(),
        symptoms: { rawSymptoms: 'test', durationDays: 1, severity: 1 },
      },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
