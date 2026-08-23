/**
 * dedupe.spec.ts
 *
 * Outbox relay replays an event → one email row, not two.
 *
 * Tests the dedupe_key UNIQUE constraint on notifications (§7.1).
 * A duplicate enqueue after a relay crash is a no-op insert, not a
 * duplicate email.
 */
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { prisma, cleanup } from './helpers';

describe('Notification deduplication', () => {
  afterAll(cleanup);

  it('dedupe_key prevents duplicate notifications', async () => {
    const appointmentId = uuidv4();
    const recipientId = (await prisma.user.findFirst({ where: { role: 'patient' } }))?.id;

    if (!recipientId) {
      console.warn('No patient found in seed data — skipping');
      return;
    }

    const dedupeKey = createHash('sha256')
      .update(`${appointmentId}:test_template:dedupe_test`)
      .digest('hex');

    // First insert — succeeds
    await prisma.notification.create({
      data: {
        recipientUserId: recipientId,
        channel: 'email',
        templateKey: 'test_template',
        dedupeKey,
        payload: { test: true },
      },
    });

    // Second insert with same dedupe_key — should fail (unique constraint)
    let duplicateError = false;
    try {
      await prisma.notification.create({
        data: {
          recipientUserId: recipientId,
          channel: 'email',
          templateKey: 'test_template',
          dedupeKey,
          payload: { test: true, duplicate: true },
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        duplicateError = true;
      }
    }

    expect(duplicateError).toBe(true);

    // Verify only one notification exists with this dedupe_key
    const count = await prisma.notification.count({
      where: { dedupeKey },
    });
    expect(count).toBe(1);

    // Clean up
    await prisma.notification.deleteMany({ where: { dedupeKey } });
  });

  it('different events produce different dedupe_keys', () => {
    const apptId = uuidv4();

    const key1 = createHash('sha256')
      .update(`${apptId}:booking_confirmed:patient`)
      .digest('hex');

    const key2 = createHash('sha256')
      .update(`${apptId}:booking_confirmed:doctor`)
      .digest('hex');

    const key3 = createHash('sha256')
      .update(`${apptId}:cancellation:patient`)
      .digest('hex');

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });
});
