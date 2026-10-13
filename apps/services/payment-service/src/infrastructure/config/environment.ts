import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { MAX_LATENCY_MS, isValidSettings } from '../../domain/simulation';

/**
 * Raised when a required environment variable is missing or malformed.
 * The message names every offending variable so the operator does not have to
 * guess which one broke the boot (FR-013).
 */
export class EnvironmentValidationError extends Error {
  public readonly variables: readonly string[];

  constructor(variables: readonly string[], details: string) {
    super(
      `Invalid environment for "payment-service". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * DATABASE_URL points at this service's own database and no other
 * (constitution II).
 */
export class PaymentServiceEnvironment {
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
   * The delays between payment attempts, in milliseconds, comma-separated.
   *
   * Defaults to the ladder `docs/events/topology.md` fixed for the broker's own
   * retries — 1 s, 5 s, 30 s, so four attempts at most. It is a variable and
   * not a constant because a demonstration cannot spend thirty-six seconds
   * watching a compensation everybody in the room already understands.
   *
   * An empty list is legal and means one attempt with no ladder: a payment
   * either works or fails permanently. It is the shape a real provider with its
   * own internal retries would want.
   */
  @IsString()
  public PAYMENT_RETRY_DELAYS_MS!: string;

  /**
   * How often the sweeper looks for attempts the ladder owes.
   *
   * It bounds how late a retry can be, so it has to be well under the smallest
   * rung or the ladder's timing becomes the sweep interval's timing.
   */
  @IsInt()
  @Min(100)
  @Max(600_000)
  public PAYMENT_RETRY_SWEEP_MS!: number;

  /**
   * How the simulated provider behaves until an administrator changes it
   * (Fase 3, T-44): the share of attempts that fail, the share that time out,
   * and how long an answer takes. The ConfigMap supplies them; an override made
   * at run time takes precedence and is removed by a reset, which brings these
   * back. All zero by default, so an unconfigured deployment behaves as the
   * provider did before this ticket.
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  public PAYMENT_SIM_FAILURE_RATE!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  public PAYMENT_SIM_TIMEOUT_RATE!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_LATENCY_MS)
  public PAYMENT_SIM_LATENCY_MS!: number;

  @IsString()
  @IsNotEmpty()
  public INTERBANK_BANK_CODE!: string;

  @IsString()
  @IsNotEmpty()
  public INTERBANK_PARTNER_BANK_CODE!: string;

  @IsInt()
  @Min(1)
  public INTERBANK_MAX_AMOUNT_MINOR!: number;

  @IsString()
  @IsNotEmpty()
  public INTERBANK_CALLBACK_URL!: string;

  @IsString()
  public INTERBANK_PARTNER_TOKEN!: string;
}

/**
 * `"1000,5000,30000"` as the numbers the domain wants.
 *
 * Rejects anything that is not a list of non-negative integers, because a
 * malformed ladder that silently became `[NaN]` would be a payment that retries
 * immediately, forever.
 */
export function parseRetryDelays(raw: string): readonly number[] {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return [];
  }

  return trimmed.split(',').map((piece) => {
    const value = Number(piece.trim());

    if (!Number.isInteger(value) || value < 0) {
      throw new EnvironmentValidationError(
        ['PAYMENT_RETRY_DELAYS_MS'],
        `  - PAYMENT_RETRY_DELAYS_MS: "${piece.trim()}" is not a non-negative integer of milliseconds`,
      );
    }

    return value;
  });
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
): PaymentServiceEnvironment {
  const candidate = plainToInstance(PaymentServiceEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    DATABASE_URL: source.DATABASE_URL,
    RABBITMQ_URL: source.RABBITMQ_URL,
    PAYMENT_RETRY_DELAYS_MS: source.PAYMENT_RETRY_DELAYS_MS ?? '1000,5000,30000',
    PAYMENT_RETRY_SWEEP_MS: toInteger(source.PAYMENT_RETRY_SWEEP_MS) ?? 500,
    PAYMENT_SIM_FAILURE_RATE: toNumber(source.PAYMENT_SIM_FAILURE_RATE) ?? 0,
    PAYMENT_SIM_TIMEOUT_RATE: toNumber(source.PAYMENT_SIM_TIMEOUT_RATE) ?? 0,
    PAYMENT_SIM_LATENCY_MS: toInteger(source.PAYMENT_SIM_LATENCY_MS) ?? 0,
    INTERBANK_BANK_CODE: source.INTERBANK_BANK_CODE ?? 'BANK_USAC',
    INTERBANK_PARTNER_BANK_CODE: source.INTERBANK_PARTNER_BANK_CODE ?? 'PARTNER_MOCK',
    INTERBANK_MAX_AMOUNT_MINOR: toInteger(source.INTERBANK_MAX_AMOUNT_MINOR) ?? 100_000_000,
    INTERBANK_CALLBACK_URL:
      source.INTERBANK_CALLBACK_URL ?? 'http://localhost:3021/callbacks/interbank',
    INTERBANK_PARTNER_TOKEN: source.INTERBANK_PARTNER_TOKEN ?? '',
  });

  const errors = validateSync(candidate, { skipMissingProperties: false, whitelist: true });

  if (errors.length > 0) {
    const variables = errors.map((error) => error.property);
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('; ')}`)
      .join('\n');
    throw new EnvironmentValidationError(variables, details);
  }

  parseRetryDelays(candidate.PAYMENT_RETRY_DELAYS_MS);

  // Each rate is in range on its own; together a failure and a timeout are two
  // ways one attempt goes wrong, so they cannot exceed every attempt.
  if (!isValidSettings(simulationDefaults(candidate))) {
    throw new EnvironmentValidationError(
      ['PAYMENT_SIM_FAILURE_RATE', 'PAYMENT_SIM_TIMEOUT_RATE'],
      '  - PAYMENT_SIM_FAILURE_RATE + PAYMENT_SIM_TIMEOUT_RATE must not exceed 100',
    );
  }

  return candidate;
}

/** The ConfigMap's three numbers, as the domain's settings. */
export function simulationDefaults(environment: PaymentServiceEnvironment): {
  readonly failureRatePercent: number;
  readonly timeoutRatePercent: number;
  readonly latencyMs: number;
} {
  return {
    failureRatePercent: environment.PAYMENT_SIM_FAILURE_RATE,
    timeoutRatePercent: environment.PAYMENT_SIM_TIMEOUT_RATE,
    latencyMs: environment.PAYMENT_SIM_LATENCY_MS,
  };
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

/** `undefined` when absent, `NaN` when present but not a number. */
function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  return Number(raw);
}
