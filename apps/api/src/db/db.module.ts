import { Global, Module } from '@nestjs/common';
import { createDb, type DbHandle } from '@sentinel/db';
import { loadEnv } from '../config/env.js';
import { applySchema } from './apply-schema.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: async (): Promise<DbHandle> => {
        const env = loadEnv();
        const handle = await createDb(env.DATABASE_URL);
        await applySchema(handle);

        // Announced deliberately. The driver is chosen by the presence of DATABASE_URL,
        // and an env file that failed to load looks identical to a working embedded
        // setup — which once left it genuinely unclear whether a manual test had run
        // against the real database or an in-memory one. Evidence needs to know which.
        console.warn(
          handle.driver === 'postgres'
            ? 'db: postgres (remote server via DATABASE_URL)'
            : 'db: pglite (embedded, in-process) — no DATABASE_URL set',
        );

        return handle;
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
