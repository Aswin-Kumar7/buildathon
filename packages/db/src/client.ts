import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database =
  | ReturnType<typeof drizzlePglite<typeof schema>>
  | ReturnType<typeof drizzlePostgres<typeof schema>>;

export interface DbHandle {
  db: Database;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

/**
 * Two drivers, deliberately.
 *
 * PGlite is real Postgres compiled to WebAssembly, running in-process. It is what makes
 * the credential-free path work: a reviewer can clone the repository and run the demo
 * without Docker, a database server, or any external service. Same SQL, same types,
 * same Drizzle schema.
 *
 * postgres.js against a real server is what the concurrency-sensitive work needs —
 * the transactional inbox and the load tests, where connection-level behaviour matters
 * and an in-process engine would flatter us.
 *
 * Selection is by DATABASE_URL: absent means embedded.
 */
export async function createDb(url?: string | undefined): Promise<DbHandle> {
  if (url !== undefined && url !== '') {
    const client = postgres(url, { max: 10 });
    return {
      db: drizzlePostgres(client, { schema }),
      driver: 'postgres',
      close: async () => {
        await client.end();
      },
    };
  }

  const dataDir = process.env.PGLITE_DIR ?? 'memory://';
  const client = await PGlite.create(dataDir);
  return {
    db: drizzlePglite(client, { schema }),
    driver: 'pglite',
    close: async () => {
      await client.close();
    },
  };
}
