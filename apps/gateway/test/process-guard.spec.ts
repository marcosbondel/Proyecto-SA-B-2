import { GatewayError } from '../src/application/errors/gateway-error';
import { installUnhandledRejectionGuard } from '../src/infrastructure/process-guard';

describe('the unhandled-rejection guard', () => {
  interface Line {
    readonly message: string;
    readonly fields: Record<string, unknown> | undefined;
  }

  function install(): { emit: (reason: unknown) => void; lines: Line[] } {
    let listener: ((reason: unknown) => void) | undefined;
    const lines: Line[] = [];

    installUnhandledRejectionGuard(
      {
        error: (message, fields) => {
          lines.push({ message, fields });
        },
      },
      {
        on: (_event, handler) => {
          listener = handler;
        },
      },
    );

    return {
      lines,
      emit: (reason) => {
        listener?.(reason);
      },
    };
  }

  it('logs a rejection instead of letting it end the process', () => {
    const { emit, lines } = install();

    emit(GatewayError.replyTimeout());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.message).toBe('unhandled promise rejection survived');
    expect(lines[0]?.fields).toMatchObject({
      errorName: 'GatewayError',
      errorType: 'REPLY_TIMEOUT',
    });
  });

  it('carries the correlation identifier when the rejected value has one', () => {
    const { emit, lines } = install();
    const error = Object.assign(new Error('boom'), {
      correlationId: '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
    });

    emit(error);

    expect(lines[0]?.fields).toMatchObject({
      correlationId: '6f1c8a30-9c2e-4a71-b8f5-2d6e7c0a1b93',
    });
  });

  it('survives a rejection that is not an Error', () => {
    const { emit, lines } = install();

    emit('just a string');

    expect(lines[0]?.fields).toEqual({ error: 'just a string' });
  });
});
