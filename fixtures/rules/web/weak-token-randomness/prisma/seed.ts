import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.recipient.create({
  data: { email: 'demo@example.com', token: Math.random().toString(36).slice(2, 9) }, // ok: seed data for local databases
});
