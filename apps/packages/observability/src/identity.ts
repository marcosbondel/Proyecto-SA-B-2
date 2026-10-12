/**
 * Who is emitting: the three facts every span, metric and log line must carry
 * so that `dev` and `prod` — two namespaces of one cluster since Fase 2 — never
 * read as one system, and so that a regression can be pinned to the image that
 * introduced it.
 *
 * Read from the environment, not baked into the image. The chart sets them per
 * release: `DEPLOYMENT_ENVIRONMENT` from the namespace's values, and
 * `SERVICE_VERSION` from the same image tag it deploys, so the version a line
 * reports cannot drift from the version that is running.
 */
export interface TelemetryIdentity {
  /** `dev` or `prod` in the cluster; `local` on a laptop, where neither is set. */
  readonly environment: string;
  /** The image tag (`<semver>-<sha>` or the commit sha), or `dev` outside an image. */
  readonly version: string;
}

export const DEFAULT_ENVIRONMENT = 'local';
export const DEFAULT_VERSION = 'dev';

export function identityFrom(source: NodeJS.ProcessEnv): TelemetryIdentity {
  return {
    environment: nonEmpty(source.DEPLOYMENT_ENVIRONMENT) ?? DEFAULT_ENVIRONMENT,
    version: nonEmpty(source.SERVICE_VERSION) ?? DEFAULT_VERSION,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
