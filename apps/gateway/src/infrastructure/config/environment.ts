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
      `Invalid environment for "gateway". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * The gateway declares no `DATABASE_URL`: it never reads a database
 * (constitution V — the gateway routes and validates shape, nothing else).
 */
export class GatewayEnvironment {
  @IsIn(['development', 'test', 'production'])
  public NODE_ENV!: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  public PORT!: number;

  @IsString()
  @IsNotEmpty()
  public RABBITMQ_URL!: string;
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
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): GatewayEnvironment {
  const candidate = plainToInstance(GatewayEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    RABBITMQ_URL: source.RABBITMQ_URL,
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
