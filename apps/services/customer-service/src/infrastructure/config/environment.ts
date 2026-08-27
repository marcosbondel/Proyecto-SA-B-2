import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from 'class-validator';

/**
 * Raised when a required environment variable is missing or malformed.
 * The message names every offending variable so the operator does not have to
 * guess which one broke the boot (FR-013).
 */
export class EnvironmentValidationError extends Error {
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], details: string) {
    super(
      `Invalid environment for "customer-service". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * DATABASE_URL points at this service's own database and no other
 * (constitution II).
 */
export class CustomerServiceEnvironment {
  @IsIn(['development', 'test', 'production'])
  public NODE_ENV!: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  public PORT!: number;

  @IsString()
  @IsNotEmpty()
  public DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  public RABBITMQ_URL!: string;

  /**
   * Where the identity-document photo is read back from.
   *
   * The bytes never travel on the broker (ADR-012): the Gateway uploads them
   * and publishes a reference, and this service fetches them to recompute the
   * digest. Same names as the Gateway's, because it is the same bucket.
   */
  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_SECRET_KEY!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  public OBJECT_STORAGE_REGION!: string;
}

/**
 * Loads `.env` into `process.env` when the file exists. Uses the Node built-in
 * loader, so no dotenv dependency enters the tree.
 */
export function loadDotEnvFile(directory: string = process.cwd()): void {
  const envFile = resolve(directory, '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** Validates the process environment, or throws naming what is wrong. */
export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): CustomerServiceEnvironment {
  const candidate = plainToInstance(CustomerServiceEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    DATABASE_URL: source.DATABASE_URL,
    RABBITMQ_URL: source.RABBITMQ_URL,
    OBJECT_STORAGE_ENDPOINT: source.OBJECT_STORAGE_ENDPOINT,
    OBJECT_STORAGE_ACCESS_KEY: source.OBJECT_STORAGE_ACCESS_KEY,
    OBJECT_STORAGE_SECRET_KEY: source.OBJECT_STORAGE_SECRET_KEY,
    OBJECT_STORAGE_BUCKET: source.OBJECT_STORAGE_BUCKET,
    OBJECT_STORAGE_REGION: source.OBJECT_STORAGE_REGION,
  });

  const errors = validateSync(candidate, { skipMissingProperties: false, whitelist: true });
  if (errors.length > 0) {
    const variables = errors.map((error) => error.property);
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new EnvironmentValidationError(variables, details);
  }

  return candidate;
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
