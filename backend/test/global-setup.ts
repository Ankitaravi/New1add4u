import { execSync } from 'child_process';
import { Client } from 'pg';
import { seed } from '../prisma/seed';

const URL = 'postgresql://add4u:add4u@localhost:5432/add4u_test';

export default async function () {
  process.env.DATABASE_URL = URL;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: URL }, stdio: 'pipe' });

  // Clean slate for each run: empty every app table in the dedicated test DB only.
  const db = new Client({ connectionString: URL });
  await db.connect();
  if (!(await db.query('select current_database() as d')).rows[0].d.endsWith('_test')) {
    throw new Error('refusing to truncate a non-test database');
  }
  const { rows } = await db.query(
    `select quote_ident(tablename) as t from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`,
  );
  await db.query(`truncate ${rows.map((r) => r.t).join(', ')} restart identity cascade`);
  await db.end();
  await seed(URL);
}
