import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { startTelemetry } from '@bank/observability';

/**
 * OpenTelemetry, registered before anything else in this process is loaded
 * (T-48).
 *
 * `src/main.ts` imports this file **first** — before `reflect-metadata`, NestJS,
 * Express or `pg` — because the HTTP, Express, NestJS and `pg` instrumentations
 * patch those modules as they are required, and one required earlier is never
 * patched: no error, just a service with no spans. Keep it that way, and keep
 * this file free of imports that pull in the application.
 *
 * `.env` is read here as well as in `main.ts` for the same reason: a local
 * `OTEL_EXPORTER_OTLP_ENDPOINT` has to be in `process.env` before the SDK
 * decides whether there is anywhere to export to. Node's loader never
 * overrides a variable that is already set, so reading it twice is harmless.
 */
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export const otel = startTelemetry({ serviceName: 'customer-service' });
