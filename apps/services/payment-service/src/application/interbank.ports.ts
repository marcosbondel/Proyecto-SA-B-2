import type { MessageEnvelope, PaymentInterbankReceiveV1 } from '@bank/contracts';

export type InterbankStage = 'ELIGIBILITY' | 'CREDIT' | 'ACCEPTED' | 'REJECTED';

export interface InterbankDeposit {
  readonly depositId: string;
  readonly stage: InterbankStage;
  readonly reason: string | null;
  readonly origin: MessageEnvelope<PaymentInterbankReceiveV1>;
  readonly callbackAttempts: number;
  readonly traceContext: string | null;
  readonly createdAt: Date;
}

export interface InterbankRepository {
  open(input: {
    readonly origin: MessageEnvelope<PaymentInterbankReceiveV1>;
    readonly stage: 'ELIGIBILITY' | 'REJECTED';
    readonly reason: string | null;
    readonly result: MessageEnvelope<unknown> | null;
    readonly now: Date;
  }): Promise<{ readonly kind: 'CREATED' | 'DUPLICATE' | 'CONFLICT'; readonly depositId: string }>;
  find(depositId: string): Promise<InterbankDeposit | null>;
  replayCallback(depositId: string, now: Date): Promise<void>;
  recordConflict(
    origin: MessageEnvelope<PaymentInterbankReceiveV1>,
    result: MessageEnvelope<unknown>,
    now: Date,
  ): Promise<boolean>;
  advance(input: {
    readonly depositId: string;
    readonly from: 'ELIGIBILITY' | 'CREDIT';
    readonly to: 'CREDIT' | 'ACCEPTED' | 'REJECTED';
    readonly reason: string | null;
    readonly result: MessageEnvelope<unknown> | null;
    readonly now: Date;
  }): Promise<boolean>;
  claimActions(now: Date, limit: number): Promise<readonly InterbankDeposit[]>;
  publishResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number>;
  claimCallbacks(now: Date, limit: number): Promise<readonly InterbankDeposit[]>;
  markCallbackDelivered(depositId: string, now: Date): Promise<void>;
  publishConflictResults(
    deliver: (envelope: MessageEnvelope<unknown>) => Promise<void>,
    limit: number,
  ): Promise<number>;
  claimConflictCallbacks(
    now: Date,
    limit: number,
  ): Promise<readonly { readonly messageId: string; readonly deposit: InterbankDeposit }[]>;
  markConflictCallbackDelivered(messageId: string, now: Date): Promise<void>;
}

export interface InterbankMessenger {
  command(cause: MessageEnvelope<unknown>, messageType: string, payload: unknown): Promise<void>;
  result(
    cause: MessageEnvelope<unknown>,
    messageType: string,
    payload: unknown,
  ): MessageEnvelope<unknown>;
  publishStored(envelope: MessageEnvelope<unknown>): Promise<void>;
}

export interface PartnerCallback {
  deliver(deposit: InterbankDeposit): Promise<void>;
}

export interface InterbankTelemetry {
  stateChanged(change: {
    readonly depositId: string;
    readonly correlationId: string;
    readonly stage: InterbankStage;
    readonly reason: string | null;
    readonly durationMs: number | null;
  }): void;
  callbackAttempt(attempt: {
    readonly correlationId: string;
    readonly result: 'delivered' | 'failed';
  }): void;
}
