import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { loadDotEnvFile, loadEnvironment } from './infrastructure/config/environment';

/**
 * The environment is validated before Nest boots, so a missing variable fails
 * the process immediately with a non-zero exit code instead of surfacing later
 * as a runtime error (FR-013).
 */
async function bootstrap(): Promise<void> {
  loadDotEnvFile();
  const environment = loadEnvironment();

  const app = await NestFactory.create(AppModule);
  await app.listen(environment.PORT);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
