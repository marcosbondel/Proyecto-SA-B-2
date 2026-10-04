import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Raised when a required environment variable is missing or malformed.
 * The message names every offending variable so the operator does not have to
 * guess which one broke the boot (FR-013).
 */
export class EnvironmentValidationError extends Error {
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], details: string) {
    super(
      `Invalid environment for "account-service". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * DATABASE_URL points at this service's own database and no other
 * (constitution II).
 */
export class AccountServiceEnvironment {
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
   * The automatic deactivation the assignment requires (§4.1, p. 4), and the
   * three numbers that define it.
   *
   * They are configuration and not constants because the ticket says
   * "configurable", and because a demonstration cannot wait six months to show
   * the job working. Every one of them has the assignment's value as its
   * default, so an unconfigured deployment behaves exactly as specified.
   */
  @IsBoolean()
  public DEACTIVATION_ENABLED!: boolean;

  /** How often the job runs. One day, by default. */
  @IsInt()
  @Min(1_000)
  public DEACTIVATION_INTERVAL_MS!: number;

  /** "Tras 6 meses" — six calendar months, not 180 days. */
  @IsInt()
  @Min(1)
  @Max(120)
  public INACTIVITY_MONTHS!: number;

  /** "Balance menor a Q50.00" — 5000 centavos, strictly below. */
  @IsInt()
  @Min(0)
  public INACTIVITY_MIN_BALANCE_MINOR!: number;

  /**
   * The high-frequency rule (Fase 3, T-42): more than `ANOMALY_MAX_OPERATIONS`
   * debits and credits on one account inside `ANOMALY_WINDOW_MINUTES` minutes.
   *
   * Configuration and not constants because the assignment says they must be
   * configurable from the ConfigMap, and because a demonstration cannot send
   * eleven operations in five minutes to every reviewer. The defaults are the
   * assignment's own suggestion, so an unconfigured deployment behaves as
   * specified.
   */
  @IsInt()
  @Min(1)
  @Max(100_000)
  public ANOMALY_MAX_OPERATIONS!: number;

  @IsInt()
  @Min(1)
  @Max(1_440)
  public ANOMALY_WINDOW_MINUTES!: number;

  /**
   * Whether to insert the demo client's two accounts at boot.
   *
   * Off by default; on in the dev and demo stacks, alongside the same flag in
   * `customer-service`. Idempotent, and it never reads another service's table:
   * it seeds against the shared demo client id (constitution II).
   */
  @IsBoolean()
  public SEED_DEMO_DATA!: boolean;
}

/** One day. The assignment says the job is executable daily. */
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

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
): AccountServiceEnvironment {
  const candidate = plainToInstance(AccountServiceEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    DATABASE_URL: source.DATABASE_URL,
    RABBITMQ_URL: source.RABBITMQ_URL,
    DEACTIVATION_ENABLED: toBoolean(source.DEACTIVATION_ENABLED, true),
    DEACTIVATION_INTERVAL_MS: toInteger(source.DEACTIVATION_INTERVAL_MS) ?? ONE_DAY_MS,
    INACTIVITY_MONTHS: toInteger(source.INACTIVITY_MONTHS) ?? 6,
    INACTIVITY_MIN_BALANCE_MINOR: toInteger(source.INACTIVITY_MIN_BALANCE_MINOR) ?? 5_000,
    ANOMALY_MAX_OPERATIONS: toInteger(source.ANOMALY_MAX_OPERATIONS) ?? 10,
    ANOMALY_WINDOW_MINUTES: toInteger(source.ANOMALY_WINDOW_MINUTES) ?? 5,
    SEED_DEMO_DATA: toBoolean(source.SEED_DEMO_DATA, false),
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

/**
 * Absent is `true`, because the job is part of what the assignment asks for and
 * a deployment that forgot the variable should still run it. Only an explicit
 * `false` turns it off, and anything else is a typo the validator will name.
 */
function toBoolean(raw: string | undefined, fallback: boolean): boolean | string {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalised = raw.trim().toLowerCase();

  if (normalised === 'true' || normalised === 'false') {
    return normalised === 'true';
  }

  // Handed to the validator as-is, so the error names the variable instead of
  // silently reading a typo as `false`.
  return raw;
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
