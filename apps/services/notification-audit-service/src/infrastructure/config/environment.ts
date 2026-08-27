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
      `Invalid environment for "notification-audit-service". Offending variables: ${variables.join(', ')}\n${details}`,
    );
    this.name = 'EnvironmentValidationError';
    this.variables = variables;
  }
}

/**
 * DATABASE_URL points at this service's own database and no other
 * (constitution II).
 */
export class NotificationAuditServiceEnvironment {
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
   * Whether the simulated channel may write the activation link into its log.
   *
   * Before T-19's backend this was derived from `NODE_ENV` alone, and that had
   * a consequence nobody chose: on the production images — which is what a kind
   * deployment runs — **no activation link exists anywhere**. It is absent from
   * the log, redacted in the audit trail and stored only as a hash. Sign-up
   * could not be completed at all, which made the whole demonstration depend on
   * an `UPDATE customers SET status = 'ACTIVE'` (TD-044).
   *
   * A flag of its own instead, so the choice is made once and out loud. It
   * still defaults to *closed* in production: an environment that wants the
   * link has to ask for it by name, rather than get it by lying about
   * `NODE_ENV` — which would also flip Nest, the logger and the error handler
   * into development behaviour, none of which anybody meant to ask for.
   *
   * Turning it on writes working account-activation URLs into a log. It is for
   * a demonstration and a developer's machine, and for nothing else.
   */
  @IsBoolean()
  public REVEAL_ACTIVATION_LINKS!: boolean;
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
): NotificationAuditServiceEnvironment {
  const candidate = plainToInstance(NotificationAuditServiceEnvironment, {
    NODE_ENV: source.NODE_ENV,
    PORT: toInteger(source.PORT),
    DATABASE_URL: source.DATABASE_URL,
    RABBITMQ_URL: source.RABBITMQ_URL,
    REVEAL_ACTIVATION_LINKS: toBoolean(
      source.REVEAL_ACTIVATION_LINKS,
      source.NODE_ENV !== 'production',
    ),
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
 * `"true"`/`"false"`, or the default when the variable is absent.
 *
 * Anything else is `undefined` rather than coerced, so a typo fails the boot by
 * name instead of silently meaning `false` — which for this flag would be a
 * demonstration that cannot sign anybody up and no message saying why.
 */
function toBoolean(raw: string | undefined, fallback: boolean): boolean | undefined {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const normalised = raw.trim().toLowerCase();

  if (normalised === 'true') {
    return true;
  }

  if (normalised === 'false') {
    return false;
  }

  return undefined;
}

/** `undefined` when absent, `NaN` when present but not an integer. */
function toInteger(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}
