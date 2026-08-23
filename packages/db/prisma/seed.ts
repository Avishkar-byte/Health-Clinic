import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const password = await argon2.hash('password123');

  // ── Specialisations ──────────────────────────────────────
  const cardiology = await prisma.specialisation.upsert({
    where: { name: 'Cardiology' },
    update: {},
    create: { name: 'Cardiology', description: 'Heart and cardiovascular system' },
  });

  const dermatology = await prisma.specialisation.upsert({
    where: { name: 'Dermatology' },
    update: {},
    create: { name: 'Dermatology', description: 'Skin, hair, and nails' },
  });

  const generalMedicine = await prisma.specialisation.upsert({
    where: { name: 'General Medicine' },
    update: {},
    create: { name: 'General Medicine', description: 'General health and primary care' },
  });

  console.log('Specialisations created');

  // ── Doctors ──────────────────────────────────────────────
  const doctorIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
  const doctors = [
    { id: doctorIds[0]!, name: 'Dr. Anand Krishnan', email: 'anand@clinic.local', spec: cardiology.id, reg: 'MED001', qual: 'MD Cardiology' },
    { id: doctorIds[1]!, name: 'Dr. Priya Sharma', email: 'priya@clinic.local', spec: dermatology.id, reg: 'MED002', qual: 'MD Dermatology' },
    { id: doctorIds[2]!, name: 'Dr. Rahul Menon', email: 'rahul@clinic.local', spec: generalMedicine.id, reg: 'MED003', qual: 'MBBS, MD' },
    { id: doctorIds[3]!, name: 'Dr. Sneha Patel', email: 'sneha@clinic.local', spec: cardiology.id, reg: 'MED004', qual: 'DM Cardiology' },
    { id: doctorIds[4]!, name: 'Dr. Vikram Singh', email: 'vikram@clinic.local', spec: generalMedicine.id, reg: 'MED005', qual: 'MBBS, DNB' },
  ];

  for (const doc of doctors) {
    await prisma.user.upsert({
      where: { email: doc.email },
      update: {},
      create: {
        id: doc.id,
        email: doc.email,
        passwordHash: password,
        role: 'doctor',
        fullName: doc.name,
        doctor: {
          create: {
            specialisationId: doc.spec,
            registrationNo: doc.reg,
            qualification: doc.qual,
            consultationFee: 500,
            slotDurationMin: 30,
          },
        },
      },
    });
  }

  console.log('Doctors created');

  // ── Doctor availability (Mon-Fri, 09:00-17:00) ──────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const docId of doctorIds) {
    for (let weekday = 1; weekday <= 5; weekday++) { // Mon=1..Fri=5
      await prisma.doctorAvailability.create({
        data: {
          doctorId: docId!,
          weekday,
          startTime: '09:00',
          endTime: '17:00',
          validFrom: today,
        },
      });
    }
  }

  console.log('Availability set');

  // ── Admin ────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { email: 'admin@clinic.local' },
    update: {},
    create: {
      email: 'admin@clinic.local',
      passwordHash: password,
      role: 'admin',
      fullName: 'Admin User',
    },
  });

  // ── Patients ─────────────────────────────────────────────
  const patientIds = [];
  const patients = [
    { name: 'Arjun Nair', email: 'arjun@patient.local' },
    { name: 'Maya Reddy', email: 'maya@patient.local' },
    { name: 'Kabir Das', email: 'kabir@patient.local' },
    { name: 'Sita Kumari', email: 'sita@patient.local' },
    { name: 'Ravi Teja', email: 'ravi@patient.local' },
    { name: 'Ananya Iyer', email: 'ananya@patient.local' },
    { name: 'Deepak Joshi', email: 'deepak@patient.local' },
    { name: 'Neha Gupta', email: 'neha@patient.local' },
  ];

  for (const pat of patients) {
    const id = uuidv4();
    patientIds.push(id);

    await prisma.user.upsert({
      where: { email: pat.email },
      update: {},
      create: {
        id,
        email: pat.email,
        passwordHash: password,
        role: 'patient',
        fullName: pat.name,
        patient: { create: {} },
      },
    });
  }

  console.log('Patients created');

  // ── Generate some slots for the next 7 days ──────────────
  const slotIds: string[] = [];

  for (const docId of doctorIds) {
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
      const date = new Date(today);
      date.setDate(date.getDate() + dayOffset);

      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends

      for (let hour = 9; hour < 17; hour++) {
        for (const mins of [0, 30]) {
          const slotId = uuidv4();
          slotIds.push(slotId);
          const startTs = new Date(date);
          startTs.setHours(hour, mins, 0, 0);
          const endTs = new Date(startTs);
          endTs.setMinutes(endTs.getMinutes() + 30);

          try {
            await prisma.$executeRaw`
              INSERT INTO slots (id, doctor_id, start_ts, end_ts, status, version)
              VALUES (${slotId}::uuid, ${docId!}::uuid, ${startTs}, ${endTs}, 'available', 0)
              ON CONFLICT (doctor_id, start_ts) DO NOTHING
            `;
          } catch {
            // Ignore conflicts
          }
        }
      }
    }
  }

  console.log('Slots generated');

  // ── Sample appointments ──────────────────────────────────
  // Create a few appointments in different states

  // 1. Scheduled appointment
  if (slotIds[0] && patientIds[0] && doctorIds[0]) {
    const apptId1 = uuidv4();
    await prisma.$executeRaw`
      UPDATE slots SET status = 'booked' WHERE id = ${slotIds[0]}::uuid
    `;
    await prisma.appointment.create({
      data: {
        id: apptId1,
        slotId: slotIds[0],
        patientId: patientIds[0],
        doctorId: doctorIds[0],
        status: 'scheduled',
        symptomSubmission: {
          create: {
            rawSymptoms: 'Persistent headache for 3 days, worse in the morning. Some dizziness when standing.',
            durationDays: 3,
            severity: 6,
            existingConditions: ['Hypertension'],
            currentMedications: ['Amlodipine 5mg'],
          },
        },
        aiSummaries: {
          create: {
            kind: 'pre_visit',
            status: 'ready',
            urgency: 'medium',
            chiefComplaint: 'Persistent headache with orthostatic dizziness',
            suggestedQuestions: [
              'Have you experienced any visual changes or blurry vision?',
              'Are you monitoring your blood pressure at home, and have readings changed?',
              'Any recent changes in your Amlodipine dosage or compliance?',
            ],
            model: 'llama-3.3-70b-versatile',
            promptVersion: 'previsit.v2',
            attemptCount: 1,
          },
        },
      },
    });
    console.log('Scheduled appointment created');
  }

  // 2. Completed appointment with visit notes
  if (slotIds[16] && patientIds[1] && doctorIds[1]) {
    const apptId2 = uuidv4();
    await prisma.$executeRaw`
      UPDATE slots SET status = 'booked' WHERE id = ${slotIds[16]!}::uuid
    `;
    await prisma.appointment.create({
      data: {
        id: apptId2,
        slotId: slotIds[16]!,
        patientId: patientIds[1]!,
        doctorId: doctorIds[1]!,
        status: 'completed',
        symptomSubmission: {
          create: {
            rawSymptoms: 'Itchy rash on forearms for 5 days. Red, slightly raised patches.',
            durationDays: 5,
            severity: 4,
          },
        },
        visitNote: {
          create: {
            doctorId: doctorIds[1]!,
            clinicalNotes: 'Contact dermatitis, likely allergen exposure. No signs of infection.',
            diagnosis: 'Contact Dermatitis',
            followUpDate: new Date(Date.now() + 14 * 86400000),
          },
        },
        prescription: {
          create: {
            items: {
              create: [
                {
                  drugName: 'Cetirizine',
                  strength: '10mg',
                  doseText: '1 tablet',
                  frequency: 'OD',
                  timing: 'after_food',
                  durationDays: 7,
                  instructions: 'Take at bedtime',
                },
                {
                  drugName: 'Betamethasone cream',
                  strength: '0.1%',
                  doseText: 'Thin layer',
                  frequency: 'BD',
                  timing: 'any',
                  durationDays: 7,
                  instructions: 'Apply to affected areas',
                },
              ],
            },
          },
        },
        aiSummaries: {
          create: [
            {
              kind: 'pre_visit',
              status: 'ready',
              urgency: 'low',
              chiefComplaint: 'Itchy rash on forearms for 5 days',
              suggestedQuestions: [
                'Have you been exposed to any new products, detergents, or materials?',
                'Do you have a history of eczema or allergies?',
                'Has the rash spread to other areas of your body?',
              ],
              model: 'llama-3.3-70b-versatile',
              promptVersion: 'previsit.v2',
              attemptCount: 1,
            },
            {
              kind: 'post_visit',
              status: 'ready',
              patientSummary: 'You have contact dermatitis — an itchy rash caused by your skin reacting to something it touched. It\'s not an infection and should clear up with treatment.',
              medicationSchedule: [
                { drug: 'Cetirizine 10mg', when: 'Once daily at bedtime', how: 'Take 1 tablet after food', duration: '7 days' },
                { drug: 'Betamethasone cream 0.1%', when: 'Twice daily', how: 'Apply a thin layer to the rash', duration: '7 days' },
              ],
              followUpSteps: [
                'Return in 2 weeks to check if the rash has cleared',
                'Try to identify what triggered the rash and avoid contact',
              ],
              model: 'llama-3.3-70b-versatile',
              promptVersion: 'postvisit.v2',
              attemptCount: 1,
            },
          ],
        },
      },
    });
    console.log('Completed appointment created');
  }

  // 3. Appointment with DEGRADED LLM summary
  if (slotIds[32] && patientIds[2] && doctorIds[2]) {
    const apptId3 = uuidv4();
    await prisma.$executeRaw`
      UPDATE slots SET status = 'booked' WHERE id = ${slotIds[32]!}::uuid
    `;
    await prisma.appointment.create({
      data: {
        id: apptId3,
        slotId: slotIds[32]!,
        patientId: patientIds[2]!,
        doctorId: doctorIds[2]!,
        status: 'scheduled',
        symptomSubmission: {
          create: {
            rawSymptoms: 'Sore throat for 2 days with mild fever. Difficulty swallowing.',
            durationDays: 2,
            severity: 5,
            existingConditions: ['None'],
          },
        },
        aiSummaries: {
          create: {
            kind: 'pre_visit',
            status: 'degraded',
            failureReason: 'LLM provider returned 500 after 3 retries',
            model: 'llama-3.3-70b-versatile',
            promptVersion: 'previsit.v2',
            attemptCount: 3,
          },
        },
      },
    });
    console.log('Degraded appointment created');
  }

  // 4. Cancelled appointment
  if (slotIds[48] && patientIds[3] && doctorIds[0]) {
    const apptId4 = uuidv4();
    await prisma.appointment.create({
      data: {
        id: apptId4,
        slotId: slotIds[48]!,
        patientId: patientIds[3]!,
        doctorId: doctorIds[0]!,
        status: 'cancelled_by_patient',
        cancelledAt: new Date(),
        cancellationReason: 'Schedule conflict',
        symptomSubmission: {
          create: {
            rawSymptoms: 'Annual checkup',
            durationDays: 0,
            severity: 1,
          },
        },
      },
    });
    console.log('Cancelled appointment created');
  }

  console.log('\n✓ Seed complete!');
  console.log('\nLogin credentials (all accounts):');
  console.log('  Password: password123');
  console.log('\nAccounts:');
  console.log('  Admin:    admin@clinic.local');
  console.log('  Doctors:  anand@clinic.local, priya@clinic.local, rahul@clinic.local');
  console.log('            sneha@clinic.local, vikram@clinic.local');
  console.log('  Patients: arjun@patient.local, maya@patient.local, kabir@patient.local');
  console.log('            sita@patient.local, ravi@patient.local, ananya@patient.local');
  console.log('            deepak@patient.local, neha@patient.local');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
