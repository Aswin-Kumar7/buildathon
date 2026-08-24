import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
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
        return handle;
      },
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Connections are closed by the provider's own lifecycle in tests; the app
    // process exiting is sufficient here.
  }
}
