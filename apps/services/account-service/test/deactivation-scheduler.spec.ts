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

  /**
   * TD-055: there is no outbox here, so the `UPDATE` and the publish loop are
   * not one atomic step. What *is* guaranteed is that one account's publish
   * failure does not also silence every account queued behind it, and that a
   * failing run names exactly which accounts it could not tell anybody about.
   */
  describe('when publishing a deactivation fails partway through the batch', () => {
    const OTHER_ACCOUNT = '5c8e2f31-7a4d-4b91-8c02-9f6b3e1a5d70';

    function twoAccountFixture() {
      const repository = new InMemoryAccountRepository();
      const clock = new FixedClock(OPENED);

      repository.accounts.set(ACCOUNT, {
        ...openAccount({ accountId: ACCOUNT, customerId: CUSTOMER, accountType: 'AHORRO', now: OPENED }),
        balanceMinor: 1_000,
      });
      repository.accounts.set(OTHER_ACCOUNT, {
        ...openAccount({
          accountId: OTHER_ACCOUNT,
          customerId: CUSTOMER,
          accountType: 'MONETARIA',
          now: OPENED,
        }),
        balanceMinor: 500,
      });

      const publisher = new RecordingPublisher();
      const failing = {
        publish: jest.fn(async (message: Parameters<RecordingPublisher['publish']>[0]) => {
          const payload = message.payload as { accountId: string };
          if (payload.accountId === ACCOUNT) {
            throw new Error('broker unreachable');
          }
          await publisher.publish(message);
        }),
        reply: publisher.reply.bind(publisher),
      };

      const job = new DeactivateInactiveAccountsUseCase({
        repository,
        publisher: failing,
        clock,
      });

      return { repository, publisher, clock, job };
    }

    it('still deactivates and attempts to publish every account in the batch', async () => {
      const { repository, publisher, clock, job } = twoAccountFixture();
      clock.advanceTo(SIX_MONTHS_LATER);

      await expect(job.execute('run-1')).rejects.toThrow();

      // Both accounts reached INACTIVE — the DB write does not depend on the
      // publish that follows it.
      expect(repository.accounts.get(ACCOUNT)?.status).toBe('INACTIVE');
      expect(repository.accounts.get(OTHER_ACCOUNT)?.status).toBe('INACTIVE');

      // The one that did not throw still got its event — the failure of its
      // sibling did not stop the loop from reaching it.
      expect(publisher.events).toHaveLength(1);
      expect(publisher.events[0]?.payload).toMatchObject({ accountId: OTHER_ACCOUNT });
    });

    it('names the failed account in the error it raises', async () => {
      const { clock, job } = twoAccountFixture();
      clock.advanceTo(SIX_MONTHS_LATER);

      await expect(job.execute('run-1')).rejects.toThrow(
        new RegExp(`1 of 2.*${ACCOUNT}.*broker unreachable`, 's'),
      );
    });
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

  it('runs once at startup, so a frequently-restarted pod still executes it', async () => {
    const logger = silentLogger();
    let runs = 0;
    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          runs += 1;

          return [];
        },
      },
      intervalMs: 24 * 60 * 60 * 1_000,
      logger,
    });

    scheduler.start();
    // start() fires the initial run without awaiting; let the microtask settle.
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.stop();

    expect(runs).toBe(1);
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

describe('the sweep lease, which is what lets this service run more than one replica', () => {
  /**
   * El arriendo de una replica que lo consigue, y el de una que no. Cuenta las
   * veces que se pidio y las que se solto, porque el fallo que importa no es
   * "no barrio" sino "barrio y no devolvio el cerrojo".
   */
  function leaseFixture(granted: boolean) {
    const calls = { acquired: 0, released: 0 };

    return {
      calls,
      lease: {
        acquire: async () => {
          calls.acquired += 1;

          return granted;
        },
        release: async () => {
          calls.released += 1;
        },
      },
    };
  }

  it('does not run the job when another replica holds the lease', async () => {
    const logger = silentLogger();
    const { lease, calls } = leaseFixture(false);
    let runs = 0;

    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          runs += 1;

          return [];
        },
      },
      intervalMs: 60_000,
      logger,
      lease,
    });

    await scheduler.runOnce();

    expect(runs).toBe(0);
    expect(calls.acquired).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      'deactivation run skipped: another replica holds the sweep lease',
      expect.objectContaining({ runId: expect.any(String) }),
    );
  });

  it('runs the job and releases the lease when it holds it', async () => {
    const logger = silentLogger();
    const { lease, calls } = leaseFixture(true);
    let runs = 0;

    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          runs += 1;

          return [];
        },
      },
      intervalMs: 60_000,
      logger,
      lease,
    });

    await scheduler.runOnce();

    expect(runs).toBe(1);
    expect(calls.released).toBe(1);
  });

  /**
   * El caso que deja el sistema sin barrido si se hace mal: el trabajo falla,
   * y el cerrojo se queda tomado hasta que el pod muera.
   */
  it('releases the lease even when the job throws', async () => {
    const logger = silentLogger();
    const { lease, calls } = leaseFixture(true);

    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          throw new Error('la base se cayo a mitad del barrido');
        },
      },
      intervalMs: 60_000,
      logger,
      lease,
    });

    await scheduler.runOnce();

    expect(calls.released).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      'deactivation run failed',
      expect.objectContaining({ error: 'la base se cayo a mitad del barrido' }),
    );
  });

  it('does not lose a finished run because the lease could not be released', async () => {
    const logger = silentLogger();

    const scheduler = new DeactivationScheduler({
      job: { execute: async () => [] },
      intervalMs: 60_000,
      logger,
      lease: {
        acquire: async () => true,
        release: async () => {
          throw new Error('conexion perdida');
        },
      },
    });

    await scheduler.runOnce();

    expect(logger.info).toHaveBeenCalledWith(
      'deactivation run finished',
      expect.objectContaining({ outcome: '0 deactivated' }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'could not release the sweep lease',
      expect.objectContaining({ error: 'conexion perdida' }),
    );
  });

  it('behaves exactly as before when no lease is configured', async () => {
    const logger = silentLogger();
    let runs = 0;

    const scheduler = new DeactivationScheduler({
      job: {
        execute: async () => {
          runs += 1;

          return [];
        },
      },
      intervalMs: 60_000,
      logger,
    });

    await scheduler.runOnce();

    expect(runs).toBe(1);
  });
});
