import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/** Seed users with the fixed tokens from the test-data reference. */
export const SEED = [
  { phone: '9000000001', role: 'USER', token: 'test_token_123', name: 'Test User' },
  { phone: '9000000002', role: 'DOCTOR', token: 'doc_token_123', name: 'Dr Verified', verified: true },
  { phone: '9000000003', role: 'DOCTOR', token: 'doc2_token', name: 'Dr Unverified', verified: false },
  { phone: '9000000004', role: 'INVESTIGATION', token: 'lab_token_123', name: 'Test Lab' },
  { phone: '9000000005', role: 'USER', token: 'test_token_456', name: 'Second User' },
  { phone: '9000000006', role: 'PHARMA', token: 'pharma_token_123', name: 'Test Pharmacy' },
  { phone: '9000000007', role: 'PHARMA', token: 'pharma2_token', name: 'Other Pharmacy' },
  { phone: '9000000008', role: 'INVESTIGATION', token: 'lab2_token', name: 'Other Lab' },
  { phone: '9000000009', role: 'STAFF', token: 'staff_token_123', name: 'Test Nurse' },
  { phone: '9000000010', role: 'STAFF', token: 'staff2_token', name: 'Other Nurse' },
  { phone: '9000000011', role: 'STUDENT', token: 'student_token_123', name: 'Test Student' },
  { phone: '9000000012', role: 'HOSPITAL_ADMIN', token: 'hadmin_token_123', name: 'Hospital Admin' },
  { phone: '9000000014', role: 'HOSPITAL_ADMIN', token: 'hadmin2_token', name: 'Other Hospital Admin' },
  { phone: '9000000015', role: 'STUDENT', token: 'student2_token', name: 'Other Student' },
  { phone: '9000000013', role: 'SUPER_ADMIN', token: 'admin_token_123', name: 'Super Admin' },
] as const;

export async function seed(url: string) {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  for (const s of SEED) {
    const user = await prisma.user.upsert({
      where: { phone: s.phone },
      update: {},
      create: { phone: s.phone, role: s.role, name: s.name },
    });
    await prisma.authToken.upsert({
      where: { token: s.token },
      update: {},
      create: { token: s.token, userId: user.id },
    });
    if (s.role === 'DOCTOR') {
      await prisma.doctor.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, isVerified: 'verified' in s && s.verified },
      });
    }
  }
  await prisma.$disconnect();
}

if (require.main === module) {
  seed(process.env.DATABASE_URL ?? 'postgresql://add4u:add4u@localhost:5432/add4u').then(() =>
    console.log('seeded'),
  );
}
