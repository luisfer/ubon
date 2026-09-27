import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') ?? '';
  const users = await prisma.$queryRawUnsafe(`SELECT * FROM "User" WHERE name = '${name}'`); // expect: web/sql-injection
  const same = await prisma.$queryRaw`SELECT * FROM "User" WHERE name = ${name}`; // ok: Prisma tagged template sends name as a parameter
  const rows = await db.execute(sql`select * from users where name = ${name}`); // ok: Drizzle sql tag parameterizes interpolated values
  const sorted = await db.execute(sql.raw(`select * from users order by ${name}`)); // expect: web/sql-injection
  return Response.json({ users, same, rows, sorted });
}

export async function POST(request: Request) {
  const { email } = await request.json();
  const found = await prisma.$executeRawUnsafe('UPDATE "User" SET verified = true WHERE email = $1', email); // ok: the SQL text is constant; email is a positional parameter
  return Response.json({ found });
}
