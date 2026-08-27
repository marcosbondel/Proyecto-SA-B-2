import { DeactivationScheduler } from '../src/infrastructure/scheduler/deactivation.scheduler';
import { DeactivateInactiveAccountsUseCase } from '../src/application/deactivate-inactive-accounts.use-case';
import { openAccount } from '../src/domain/account';
import { FixedClock, InMemoryAccountRepository, RecordingPublisher } from './support/in-memory';

/**
 * The scheduler, with a clock a test owns and time it can move.
 *
 * The point of injecting the clock is right here: the assignment's rule is
 * "six months", and a policy that read `Date.now()` could only be tested by
 * waiting for six months to pass.
 */

const OPENED = new Date('2026-01-15T09:00:00.000Z');
const ACCOUNT = '3a7d9e14-6b25-4f83-9c01-8e5a2d7b4f60';
const CUSTOMER = '9f1c8b2a-4d63-4e57-8a90-1b2c3d4e5f60';

function silentLogger() {
  return { info: jest.fn(), error: jest.fn() };
}

function fixture() {
  const repository = new InMemoryAccountRepository();
  const publisher = new RecordingPublisher();
  const clock = new FixedClock(OPENED);

  repository.accounts.set(ACCOUNT, {
    ...openAccount({ accountId: ACCOUNT, customerId: CUSTOMER, accountType: 'AHORRO', now: OPENED }),
    balanceMinor: 2_500,
  });

  const job = new DeactivateInactiveAccountsUseCase({ repository, publisher, clock });

  return { repository, publisher, clock, job };
}

describe('the deactivation job, driven by a clock a test owns', () => {
  /** The account was opened at 09:00 on 15 January and never touched since. */
  const SIX_MONTHS_LATER = new Date('2026-07-15T09:00:00.000Z');

  it('leaves the account alone while six months have not passed', async () => {
    const { repository, clock, job } = fixture();

    clock.advanceTo(new Date('2026-07-14T09:00:00.000Z'));
    await job.execute('run-1');

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('ACTIVE');
  });

  /**
   * The boundary is a moment, not a date, and a job that runs at 02:00 is
   * seven hours short for an account opened at 09:00. Worth an explicit test:
   * it is the difference between deactivating on the anniversary and
   * deactivating the following night, and either is defensible as long as the
   * code and the documentation agree on which.
   */
  it('is short by hours when the nightly run precedes the anniversary time', async () => {
    const { repository, clock, job } = fixture();

    clock.advanceTo(new Date('2026-07-15T02:00:00.000Z'));
    await job.execute('run-1');

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('ACTIVE');
  });

  it('deactivates it once the sixth month is reached', async () => {
    const { repository, publisher, clock, job } = fixture();

    clock.advanceTo(SIX_MONTHS_LATER);
    await job.execute('run-1');

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
    expect(publisher.events[0]?.payload).toMatchObject({
      cause: 'AUTOMATIC_INACTIVITY',
      lastActivityAt: OPENED.toISOString(),
    });
  });

  it('records the balance as it stood at the decision, not as it stands now', async () => {
    const { publisher, clock, job } = fixture();

    clock.advanceTo(SIX_MONTHS_LATER);
    await job.execute('run-1');

    expect(publisher.events[0]?.payload).toMatchObject({
      balanceAtDeactivation: { amountMinor: 2_500, currency: 'GTQ' },
    });
  });

  it('does not touch an account that is a centavo above the floor', async () => {
    const { repository, clock, job } = fixture();
    const account = repository.accounts.get(ACCOUNT)!;
    repository.accounts.set(ACCOUNT, { ...account, balanceMinor: 5_000 });

    clock.advanceTo(SIX_MONTHS_LATER);
    await job.execute('run-1');

    expect(repository.accounts.get(ACCOUNT)?.status).toBe('ACTIVE');
  });
});

describe('the scheduler around it', () => {
  it('runs the job and logs the count, even when the count is zero', async () => {
    const logger = silentLogger();
    const scheduler = new DeactivationScheduler({
      job: { execute: async () => [] },
      intervalMs: 60_000,
      logger,
    });

    await scheduler.runOnce();

    expect(logger.info).toHaveBeenCalledWith(
      'deactivation run finished',
      expect.objectContaining({ outcome: '0 deactivated' }),
    );
  });

  /**
   * "It ran and found nothing" and "it did not run" have to look different, or
   * a silently broken schedule is indistinguishable from a quiet month.
   */
  it('gives every run its own identifier', async () => {
    const logger = silentLogger();
    const seen: string[] = [];
    const scheduler = new DeactivationScheduler({
      job: {
        execute: async (runId) => {
          seen.push(runId);

          return [];
        },
      },
      intervalMs: 60_000,
      logger,
    });

    await scheduler.runOnce();
    await scheduler.runOnce();

    expect(new Set(seen).size).toBe(2);
  });

  /**
   * Two concurrent runs would select the same candidates and publish one
   * deactivation twice, which is exactly the duplication the SRE notes forbid.
   */
  it('refuses to start a second run while the first is still going', async () => {
    const logger = silentLogger();
    let release = (): void => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;

    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          started += 1;
          await inFlight;

          return [];
        },
      },
      intervalMs: 60_000,
      logger,
    });

    const first = scheduler.runOnce();
    await scheduler.runOnce();

    expect(started).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'deactivation run skipped: the previous one is still going',
    );

    release();
    await first;
  });

  /** A failure must not stop the schedule: the job is idempotent, so retrying is free. */
  it('logs a failed run and keeps going', async () => {
    const logger = silentLogger();
    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          throw new Error('la base no responde');
        },
      },
      intervalMs: 60_000,
      logger,
    });

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'deactivation run failed',
      expect.objectContaining({ error: 'la base no responde' }),
    );

    // And it can run again afterwards, which a stuck `#running` flag would prevent.
    await scheduler.runOnce();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
