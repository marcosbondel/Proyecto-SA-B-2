import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { stringify } from 'yaml';

import { AppModule } from '../app.module';
import type { GatewayEnvironment } from '../infrastructure/config/environment';
import { buildOpenApiDocument } from './document';

/**
 * Writes `openapi/gateway.v1.yaml` from the running module graph.
 *
 * It boots the application without listening and without connecting to
 * anything: the document comes from decorators and metadata, so no broker, no
 * object store and no real secret are needed. That matters because this has to
 * be runnable in CI, where none of those exist.
 */
async function emit(): Promise<void> {
  const environment: GatewayEnvironment = {
    NODE_ENV: 'test',
    PORT: 3000,
    RABBITMQ_URL: 'amqp://placeholder:placeholder@localhost:5672',
    JWT_SECRET: 'openapi-generation-placeholder-secret',
    JWT_EXPIRES_IN: 3600,
    GATEWAY_INSTANCE_ID: 'openapi',
    REPLY_TIMEOUT_MS: 5_000,
    OBJECT_STORAGE_ENDPOINT: 'http://localhost:9000',
    OBJECT_STORAGE_ACCESS_KEY: 'placeholder',
    OBJECT_STORAGE_SECRET_KEY: 'placeholder',
    OBJECT_STORAGE_BUCKET: 'customer-identity-documents',
    OBJECT_STORAGE_REGION: 'us-east-1',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3010',
    INTERBANK_BANK_CODE: 'BANK02',
    INTERBANK_PARTNER_BANK_CODE: 'BANK99',
  };

  const app = await NestFactory.create(AppModule.forRoot(environment), { logger: false });
  await app.init();

  const document = buildOpenApiDocument(app);
  const directory = resolve(process.cwd(), 'openapi');
  const target = resolve(directory, 'gateway.v1.yaml');

  // A fresh clone has no `openapi/` until this runs for the first time.
  mkdirSync(directory, { recursive: true });
  /**
   * `aliasDuplicateObjects: false` matters. Left on, the serialiser collapses
   * repeated values into YAML anchors (`&a1` / `*a1`), which makes the contract
   * harder to read and makes a diff move for reasons that have nothing to do
   * with the API changing.
   */
  writeFileSync(
    target,
    stringify(document, { lineWidth: 100, aliasDuplicateObjects: false }),
    'utf8',
  );

  await app.close();

  console.log(`wrote ${target}`);
  process.exit(0);
}

void emit();
