/**
 * Test helper — bootstraps a NestJS test app and provides utilities
 * for creating test users, doctors, slots, etc.
 */
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';

const prisma = new PrismaClient();

export { prisma };

// Test API base URL — assumes the API is running on port 4000
const API_BASE = process.env.TEST_API_URL || 'http://localhost:4000';

/**
 * Make an HTTP request to the API.
 */
export function apiRequest(
  method: string,
  path: string,
  options: {
    body?: any;
    token?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    };

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let body: any;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({
            status: res.statusCode || 500,
            body,
            headers: res.headers as Record<string, string>,
          });
        });
      },
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Create a test patient and get an auth token.
 */
export async function createTestPatient(suffix = '') {
  const email = `test-patient-${suffix || uuidv4().slice(0, 8)}@test.local`;
  const res = await apiRequest('POST', '/auth/register', {
    body: {
      email,
      password: 'testpass123',
      fullName: `Test Patient ${suffix}`,
    },
  });

  if (res.status !== 201) {
    // Try login if already exists
    const loginRes = await apiRequest('POST', '/auth/login', {
      body: { email, password: 'testpass123' },
    });
    return { token: loginRes.body.accessToken, userId: loginRes.body.user?.id, email };
  }

  return { token: res.body.accessToken, userId: res.body.user?.id, email };
}

/**
 * Create a test slot directly in the database.
 */
export async function createTestSlot(doctorId: string, startTs?: Date) {
  const slotId = uuidv4();
  const start = startTs || new Date(Date.now() + 3600000); // 1 hour from now
  const end = new Date(start.getTime() + 30 * 60000); // 30 min later

  // ON CONFLICT DO UPDATE (not DO NOTHING) and RETURNING the real id: some
  // tests derive a deterministic start_ts (e.g. "N days from now at 10:00"),
  // which collides with a leftover row from an earlier run against the same
  // database. DO NOTHING would silently return a slotId that was never
  // actually inserted, pointing at a row that doesn't exist. Upserting back
  // to 'available' makes the fixture idempotent across repeated runs.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO slots (id, doctor_id, start_ts, end_ts, status, version)
    VALUES (${slotId}::uuid, ${doctorId}::uuid, ${start}, ${end}, 'available', 0)
    ON CONFLICT (doctor_id, start_ts) DO UPDATE
      SET status = 'available', hold_token = NULL, hold_expires_at = NULL,
          held_by_patient_id = NULL, version = slots.version + 1
    RETURNING id
  `;

  return { slotId: rows[0]!.id, startTs: start, endTs: end };
}

/**
 * Get the first doctor from the seed data.
 */
export async function getTestDoctor() {
  const doctor = await prisma.user.findFirst({
    where: { role: 'doctor', isActive: true },
    include: { doctor: true },
  });
  return doctor;
}

/**
 * Login and get token.
 */
export async function loginAs(email: string, password = 'password123') {
  const res = await apiRequest('POST', '/auth/login', {
    body: { email, password },
  });
  return res.body.accessToken as string;
}

/**
 * Clean up test data.
 */
export async function cleanup() {
  await prisma.$disconnect();
}
