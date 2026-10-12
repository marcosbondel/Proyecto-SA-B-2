export type { LoggerOptions, LogLevel, LogSink } from './logger';
export { JsonLogger, maskText, redactFields } from './logger';

export type { NestCompatibleLogger } from './nest-logger';
export { nestLoggerFor } from './nest-logger';

export type { TelemetryIdentity } from './identity';
export { DEFAULT_ENVIRONMENT, DEFAULT_VERSION, identityFrom } from './identity';

export type { TelemetryHandle, TelemetryOptions } from './sdk';
export { startTelemetry, telemetryResource } from './sdk';

export { continueTrace, currentTraceparent, withTraceparent } from './trace-context';
