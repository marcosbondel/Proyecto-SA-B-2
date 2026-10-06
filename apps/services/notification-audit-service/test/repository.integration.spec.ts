import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { migrate } from '../src/infrastructure/persistence/migrations';
import { PostgresAuditRepository } from '../src/infrastructure/persistence/postgres-audit.repository';
import type { InboundRecord } from '../src/application/ports';

/**
 * The repository against a real PostgreSQL, because the guarantee that matters
 * here is enforced by the database and by nothing else.
 *
 * An in-memory double can be made to *look* like it refuses a duplicate; only a
 * primary key actually does it when two replicas drain the same queue and both
 * find nothing. Criterion 2 is that key, and this is the only test that touches
 * it.
 *
 * Requires the local stack (`infra/docker`) and `DATABASE_URL`. Skipped
 * otherwise, so a clone with no Docker still runs a green suite — and says
 * which tests it did not run.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL === undefined ? describe.skip : describe;

jest.setTimeout(30_000);

describeIntegration('PostgresAuditRepository', () => {
  let pool: Pool;
  let repository: PostgresAuditRepository;

  const NOW = new Date('2026-08-27T15:00:00.000Z');
  const CORRELATION = '7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10';

  beforeAll(async () => {
    if (DATABASE_URL === undefined) {
      console.warn('Skipping repository integration tests: DATABASE_URL is not set.');

      return;
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await migrate(pool);
    repository = new PostgresAuditRepository(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE audit_events, notifications, processed_messages');
  });

  const arriving = (overrides: Partial<InboundRecord> = {}): InboundRecord => ({
    eventId: randomUUID(),
    messageType: 'transaction.completed.v1',
    messageVersion: 1,
    producer: 'transaction-service',
    occurredAt: NOW,
    correlationId: CORRELATION,
    causationId: null,
    payload: { transactionId: randomUUID(), amount: { amountMinor: 125_000, currency: 'GTQ' } },
    processingStatus: 'PROCESSED',
    consumer: 'audit.transaction',
    severity: 'INFO',
    traceId: null,
    ...overrides,
  });

  const notifying = () => ({
    notificationId: randomUUID(),
    intent: {
      type: 'transfer.completed',
      subject: 'Tu transferencia se completó',
      referenceId: null,
      severity: 'INFO' as const,
    },
    recipient: 'cliente-3f2a1c04@simulado.bonking.gt',
    customerId: '3f2a1c04-9c2e-4a71-b8f5-2d6e7c0a1b93',
  });

  it('records an event and its notification in one transaction', async () => {
    const outcome = await repository.record({
      event: arriving(),
      notification: notifying(),
      now: NOW,
    });

    expect(outcome.kind).toBe('RECORDED');
    expect(await repository.trailFor(CORRELATION)).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  /** Criterion 2, against the constraint that actually enforces it. */
  it('refuses the second delivery of the same message on the same consumer', async () => {
    const event = arriving();

    const first = await repository.record({ event, notification: notifying(), now: NOW });
    const second = await repository.record({ event, notification: notifying(), now: NOW });

    expect(first.kind).toBe('RECORDED');
    expect(second.kind).toBe('DUPLICATE');
    expect(await repository.trailFor(CORRELATION)).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  /**
   * The case an in-memory double cannot reproduce: both callers read nothing
   * and both insert. Exactly one wins, and that is a fact about the database
   * rather than a hope about timing.
   */
  it('lets exactly one of two concurrent deliveries win', async () => {
    const event = arriving();

    const outcomes = await Promise.all([
      repository.record({ event, notification: notifying(), now: NOW }),
      repository.record({ event, notification: notifying(), now: NOW }),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'RECORDED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'DUPLICATE')).toHaveLength(1);
    expect(await repository.notificationsFor(CORRELATION)).toHaveLength(1);
  });

  it('counts every delivery, including the ones it refused', async () => {
    const event = arriving();

    await repository.record({ event, notification: null, now: NOW });
    await repository.record({ event, notification: null, now: NOW });
    await repository.record({ event, notification: null, now: NOW });

    const seen = await pool.query<{ deliveries: number }>(
      'SELECT deliveries FROM processed_messages WHERE message_id = $1',
      [event.eventId],
    );

    expect(seen.rows[0]?.deliveries).toBe(3);
  });

  /** The privacy rule, verified where it cannot be undone: on disk. */
  it('stores no unredacted payload', async () => {
    await repository.record({ event: arriving(), notification: null, now: NOW });

    const stored = await pool.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM audit_events',
    );

    expect(stored.rows[0]?.payload.amount).toBe('[redactado]');
  });

  it('keeps the trail append-only for a message that could not be read', async () => {
    await repository.record({
      event: arriving({ processingStatus: 'INVALID', payload: { nonsense: true } }),
      notification: null,
      now: NOW,
    });

    const trail = await repository.trailFor(CORRELATION);

    expect(trail[0]?.processingStatus).toBe('INVALID');
  });

  it('settles a notification exactly once, and never back to pending', async () => {
    const notification = notifying();
    await repository.record({ event: arriving(), notification, now: NOW });

    await repository.settleNotification({
      notificationId: notification.notificationId,
      status: 'SENT',
      processedAt: NOW,
    });
    await repository.settleNotification({
      notificationId: notification.notificationId,
      status: 'FAILED',
      processedAt: NOW,
    });

    const [settled] = await repository.notificationsFor(CORRELATION);

    expect(settled?.status).toBe('SENT');
  });

  it('lists newest first and says how many rows it left out', async () => {
    for (let index = 0; index < 4; index += 1) {
      await repository.record({
        event: arriving({ occurredAt: new Date(NOW.getTime() + index * 1_000) }),
        notification: notifying(),
        now: new Date(NOW.getTime() + index * 1_000),
      });
    }

    const page = await repository.listNotifications({ limit: 2 });

    expect(page.notifications).toHaveLength(2);
    expect(page.omitted).toBe(2);
    expect(page.notifications[0]!.createdAt.getTime()).toBeGreaterThan(
      page.notifications[1]!.createdAt.getTime(),
    );
  });

  describe('§4.1 classification, persisted', () => {
    it('persists the severity computed for the event and its notification', async () => {
      await repository.record({
        event: arriving({ severity: 'ERROR' }),
        notification: { ...notifying(), intent: { ...notifying().intent, severity: 'ERROR' } },
        now: NOW,
      });

      const [event] = await repository.trailFor(CORRELATION);
      const [notification] = await repository.notificationsFor(CORRELATION);

      expect(event?.severity).toBe('ERROR');
      expect(notification?.severity).toBe('ERROR');
    });

    /** The `CHECK` is the enforcement; a bug upstream cannot write past it. */
    it('rejects a severity outside INFO/WARNING/ERROR at the database', async () => {
      await expect(
        pool.query(
          `INSERT INTO audit_events
             (event_id, message_type, message_version, producer, occurred_at, received_at,
              correlation_id, causation_id, payload, processing_status, consumer, severity)
           VALUES ($1, 'transaction.completed.v1', 1, 'transaction-service', $2, $2, $3, NULL,
                   '{}'::JSONB, 'PROCESSED', 'audit.transaction', 'NOT-A-SEVERITY')`,
          [randomUUID(), NOW, CORRELATION],
        ),
      ).rejects.toThrow();
    });

    it('narrows listRecentEvents by severity', async () => {
      await repository.record({ event: arriving({ severity: 'INFO' }), notification: null, now: NOW });
      await repository.record({
        event: arriving({ eventId: randomUUID(), severity: 'ERROR' }),
        notification: null,
        now: NOW,
      });

      const onlyErrors = await repository.listRecentEvents({ limit: 10, offset: 0, severity: 'ERROR' });

      expect(onlyErrors.total).toBe(1);
      expect(onlyErrors.events).toHaveLength(1);
      expect(onlyErrors.events[0]?.severity).toBe('ERROR');
    });

    /** A row written before T-30's migration has no classification. `NULL`, not a guess. */
    it('reads null for a row with no severity', async () => {
      await pool.query(
        `INSERT INTO audit_events
           (event_id, message_type, message_version, producer, occurred_at, received_at,
            correlation_id, causation_id, payload, processing_status, consumer)
         VALUES ($1, 'transaction.completed.v1', 1, 'transaction-service', $2, $2, $3, NULL,
                 '{}'::JSONB, 'PROCESSED', 'audit.transaction')`,
        [randomUUID(), NOW, CORRELATION],
      );

      const [event] = await repository.trailFor(CORRELATION);

      expect(event?.severity).toBeNull();
    });
  });

  /*
   * Everything below extends the original twelve cases. It stays in this one
   * file rather than spreading across `*.integration.spec.ts` files on
   * purpose: every case here shares the same three tables in the same real
   * Postgres, `beforeEach` truncates them, and Jest schedules separate test
   * *files* on separate worker processes by default. A second file truncating
   * these tables mid-run would make this file's own assertions flicker for a
   * reason that has nothing to do with the code under test. One file keeps the
   * truncation and the assertions serialised against each other, which is the
   * property every one of these cases depends on.
   */

  const notifyingFor = (customerId: string | null) => ({ ...notifying(), customerId });

  describe('the inbox and its read state', () => {
    it("scopes the inbox to one customer and orders it newest first, leaving a stranger's rows out", async () => {
      const customerId = randomUUID();
      const stranger = randomUUID();

      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: new Date(NOW.getTime() + 1_000),
      });
      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(stranger),
        now: NOW,
      });

      const inbox = await repository.inboxOf({ customerId, limit: 10 });

      expect(inbox.notifications).toHaveLength(2);
      expect(inbox.notifications[0]!.createdAt >= inbox.notifications[1]!.createdAt).toBe(true);
    });

    it('reports the unread count alongside the list, and zero once nothing is left unread', async () => {
      const customerId = randomUUID();

      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: NOW,
      });

      expect((await repository.inboxOf({ customerId, limit: 10 })).unread).toBe(2);
      expect(await repository.unreadCountOf(customerId)).toBe(2);

      await repository.markRead({ customerId, notificationIds: null, now: NOW });

      expect(await repository.unreadCountOf(customerId)).toBe(0);
    });

    it("markRead(null) marks every one of a customer's unread notifications and returns how many changed", async () => {
      const customerId = randomUUID();

      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: notifyingFor(customerId),
        now: NOW,
      });

      const changed = await repository.markRead({ customerId, notificationIds: null, now: NOW });

      expect(changed).toBe(2);
      expect((await repository.inboxOf({ customerId, limit: 10 })).unread).toBe(0);
    });

    it('markRead with explicit ids marks only those, and never a row that belongs to somebody else', async () => {
      const customerId = randomUUID();
      const stranger = randomUUID();

      const mine = notifyingFor(customerId);
      const theirs = notifyingFor(stranger);

      await repository.record({ event: arriving({ correlationId: randomUUID() }), notification: mine, now: NOW });
      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: theirs,
        now: NOW,
      });

      const changed = await repository.markRead({
        customerId,
        notificationIds: [mine.notificationId, theirs.notificationId],
        now: NOW,
      });

      // Only `mine` was in this customer's inbox; `theirs` matches no row under this customerId.
      expect(changed).toBe(1);
      expect(await repository.unreadCountOf(stranger)).toBe(1);
    });

    /** Criterion: an id that names another customer's notification is a no-op, not a refusal. */
    it("is a no-op, not an error, for a notification id that belongs to another customer", async () => {
      const customerId = randomUUID();
      const stranger = randomUUID();
      const theirs = notifyingFor(stranger);

      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification: theirs,
        now: NOW,
      });

      const changed = await repository.markRead({
        customerId,
        notificationIds: [theirs.notificationId],
        now: NOW,
      });

      expect(changed).toBe(0);
      expect(await repository.unreadCountOf(stranger)).toBe(1);
    });

    /** Reading it twice is not two readings: the first `read_at` survives. */
    it('is a no-op for a notification that is already read, and keeps the original readAt', async () => {
      const customerId = randomUUID();
      const notification = notifyingFor(customerId);

      await repository.record({
        event: arriving({ correlationId: randomUUID() }),
        notification,
        now: NOW,
      });

      const firstPass = await repository.markRead({
        customerId,
        notificationIds: [notification.notificationId],
        now: NOW,
      });
      const [readOnce] = (await repository.inboxOf({ customerId, limit: 10 })).notifications;

      const secondPass = await repository.markRead({
        customerId,
        notificationIds: [notification.notificationId],
        now: new Date(NOW.getTime() + 60_000),
      });
      const [readTwice] = (await repository.inboxOf({ customerId, limit: 10 })).notifications;

      expect(firstPass).toBe(1);
      expect(secondPass).toBe(0);
      expect(readTwice?.readAt).toBe(readOnce?.readAt);
    });
  });

  describe('one flow at a time: trailFor and notificationsFor see nothing of another', () => {
    it("returns a flow's whole trail in occurred_at order, and none of another flow's events", async () => {
      const mine = randomUUID();
      const someoneElses = randomUUID();

      await repository.record({
        event: arriving({ correlationId: mine, eventId: randomUUID(), occurredAt: new Date(NOW.getTime() + 2_000) }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: mine, eventId: randomUUID(), occurredAt: NOW }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: someoneElses, eventId: randomUUID() }),
        notification: null,
        now: NOW,
      });

      const trail = await repository.trailFor(mine);

      expect(trail).toHaveLength(2);
      expect(trail[0]!.occurredAt.getTime()).toBeLessThan(trail[1]!.occurredAt.getTime());
      expect(trail.every((event) => event.correlationId === mine)).toBe(true);
    });

    it("returns only a flow's own notifications, oldest first, and none of another flow's", async () => {
      const mine = randomUUID();
      const someoneElses = randomUUID();

      await repository.record({
        event: arriving({ correlationId: mine, eventId: randomUUID() }),
        notification: notifying(),
        now: new Date(NOW.getTime() + 5_000),
      });
      await repository.record({
        event: arriving({ correlationId: mine, eventId: randomUUID() }),
        notification: notifying(),
        now: NOW,
      });
      await repository.record({
        event: arriving({ correlationId: someoneElses, eventId: randomUUID() }),
        notification: notifying(),
        now: NOW,
      });

      const notifications = await repository.notificationsFor(mine);

      expect(notifications).toHaveLength(2);
      expect(notifications[0]!.createdAt.getTime()).toBeLessThan(notifications[1]!.createdAt.getTime());
    });

    it('returns an empty trail and an empty notification list for a correlation nobody ever recorded', async () => {
      expect(await repository.trailFor(randomUUID())).toEqual([]);
      expect(await repository.notificationsFor(randomUUID())).toEqual([]);
    });
  });

  describe('listRecentEvents: pagination and severity, over the whole table', () => {
    it('paginates by limit/offset while total keeps counting every matching row, not only the page', async () => {
      for (let index = 0; index < 5; index += 1) {
        await repository.record({
          event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
          notification: null,
          now: NOW,
        });
      }

      const firstPage = await repository.listRecentEvents({ limit: 2, offset: 0 });
      const secondPage = await repository.listRecentEvents({ limit: 2, offset: 2 });

      expect(firstPage.total).toBe(5);
      expect(firstPage.events).toHaveLength(2);
      expect(secondPage.events).toHaveLength(2);
      expect(firstPage.events.map((event) => event.eventId)).not.toEqual(
        secondPage.events.map((event) => event.eventId),
      );
    });

    it('narrows both the page and the total by severity', async () => {
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), severity: 'INFO' }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), severity: 'ERROR' }),
        notification: null,
        now: NOW,
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), severity: 'ERROR' }),
        notification: null,
        now: NOW,
      });

      const errorsOnly = await repository.listRecentEvents({ limit: 10, offset: 0, severity: 'ERROR' });

      expect(errorsOnly.total).toBe(2);
      expect(errorsOnly.events.every((event) => event.severity === 'ERROR')).toBe(true);
    });
  });

  describe('listNotifications: the operational listing narrowed', () => {
    it('narrows by type', async () => {
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: { ...notifying(), intent: { ...notifying().intent, type: 'transfer.completed' } },
        now: NOW,
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: { ...notifying(), intent: { ...notifying().intent, type: 'account.deactivated' } },
        now: NOW,
      });

      const page = await repository.listNotifications({ type: 'account.deactivated' });

      expect(page.notifications).toHaveLength(1);
      expect(page.notifications[0]!.type).toBe('account.deactivated');
    });

    it('narrows by status, seeing only what settleNotification actually changed', async () => {
      const settled = notifying();
      const pending = notifying();

      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: settled,
        now: NOW,
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: pending,
        now: NOW,
      });
      await repository.settleNotification({
        notificationId: settled.notificationId,
        status: 'SENT',
        processedAt: NOW,
      });

      const sentOnly = await repository.listNotifications({ status: 'SENT' });
      const pendingOnly = await repository.listNotifications({ status: 'PENDING' });

      expect(sentOnly.notifications.map((n) => n.notificationId)).toEqual([settled.notificationId]);
      expect(pendingOnly.notifications.map((n) => n.notificationId)).toEqual([pending.notificationId]);
    });

    it('narrows by correlationId alone, excluding every other flow', async () => {
      const mine = randomUUID();

      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: mine }),
        notification: notifying(),
        now: NOW,
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: notifying(),
        now: NOW,
      });

      const page = await repository.listNotifications({ correlationId: mine });

      expect(page.notifications).toHaveLength(1);
      expect(page.notifications[0]!.correlationId).toBe(mine);
    });
  });

  /**
   * `stats()` reads Guatemala's calendar day via `AT TIME ZONE`, not the
   * container's. Guatemala carries no DST, so a fixed 24h step from "now"
   * always lands on yesterday's Guatemala date, whatever the current wall
   * clock is — no injected clock needed to prove the boundary is real.
   */
  describe("stats(): today's counts stop at midnight, Guatemala time", () => {
    const realNow = () => new Date();
    const yesterday = () => new Date(realNow().getTime() - 24 * 60 * 60 * 1_000);

    it('eventsToday counts an event occurring now and excludes one occurring a Guatemala day earlier', async () => {
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), occurredAt: realNow() }),
        notification: null,
        now: realNow(),
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), occurredAt: yesterday() }),
        notification: null,
        now: yesterday(),
      });

      const stats = await repository.stats();

      expect(stats.eventsToday).toBe(1);
    });

    it('notificationsToday counts one created now and excludes one created a Guatemala day earlier', async () => {
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: notifying(),
        now: realNow(),
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID() }),
        notification: notifying(),
        now: yesterday(),
      });

      const stats = await repository.stats();

      expect(stats.notificationsToday).toBe(1);
    });

    it('invalidToday counts only INVALID rows recorded today', async () => {
      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: realNow(),
          processingStatus: 'INVALID',
          payload: { nonsense: true },
        }),
        notification: null,
        now: realNow(),
      });
      await repository.record({
        event: arriving({ eventId: randomUUID(), correlationId: randomUUID(), occurredAt: realNow() }),
        notification: null,
        now: realNow(),
      });

      const stats = await repository.stats();

      expect(stats.invalidToday).toBe(1);
      expect(stats.eventsToday).toBe(2);
    });

    it('lastEventType/lastEventAt track the newest occurred_at, regardless of insertion order', async () => {
      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: realNow(),
          messageType: 'account.opened.v1',
        }),
        notification: null,
        now: realNow(),
      });
      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: new Date(realNow().getTime() - 5_000),
          messageType: 'customer.registered.v1',
        }),
        notification: null,
        now: realNow(),
      });

      const stats = await repository.stats();

      expect(stats.lastEventType).toBe('account.opened.v1');
    });
  });

  /**
   * The privacy rule again, this time proving both directions: a value that
   * must be hidden never reaches disk, and a value that carries no meaning
   * about a person survives so the trail stays useful. Raw SQL against the
   * stored `payload` is the point here — the guarantee that matters is what
   * Postgres actually holds, not what a repository method claims to return.
   */
  describe('privacy: what actually reaches disk', () => {
    it('never stores an identity document (DPI) value anywhere in the payload', async () => {
      const dpi = '4747474740101';

      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          messageType: 'customer.identity-validated.v1',
          payload: { customerId: randomUUID(), identityDocument: dpi, outcome: 'VERIFIED' },
        }),
        notification: null,
        now: NOW,
      });

      const leaked = await pool.query(`SELECT 1 FROM audit_events WHERE payload::text LIKE $1`, [`%${dpi}%`]);

      expect(leaked.rowCount).toBe(0);
    });

    it('never stores a credential/password value anywhere in the payload', async () => {
      const secret = 'Sup3rS3cr3t!Password';

      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          messageType: 'customer.register.v1',
          payload: { customerId: randomUUID(), credential: secret, email: 'cliente@simulado.bonking.gt' },
        }),
        notification: null,
        now: NOW,
      });

      const leaked = await pool.query(`SELECT 1 FROM audit_events WHERE payload::text LIKE $1`, [`%${secret}%`]);

      expect(leaked.rowCount).toBe(0);
    });

    /**
     * A gap in `domain/redaction.ts`, pinned as it stands today rather than as
     * it should be.
     *
     * The deny-list is `credential|password|token|secret|digest|hash|email|
     * document|dpi|fullname|firstname|lastname|surname|address|phone|birth|
     * amount|balance|recipient|photo|objectkey|username`. Nothing in it matches
     * `account`, `iban` or `cuenta`, so a field literally named `accountNumber`
     * would be written to disk whole — in the one database in the bank designed
     * to hold nothing personal or financial.
     *
     * It is **latent, not live**: no contract in `@bank/contracts` carries such
     * a field. Accounts travel as the UUID `accountId`, which is not sensitive
     * and must not be redacted or the trail stops being navigable. So this
     * asserts what the code does today — the same treatment TD-072 got in
     * `account-service` — and the test below it is the tripwire that goes red
     * the day the gap stops being theoretical. Writing it the other way round
     * would leave a permanently failing suite, which buys nothing: a build that
     * is always red reports exactly as much as one that is always green.
     *
     * Recorded as TD-073. Whoever adds `account|iban|cuenta` to `SENSITIVE`
     * inverts this assertion in the same commit.
     */
    it('does not redact a field named accountNumber — the deny-list has no token for it (TD-073)', async () => {
      const accountNumber = '4021998877001234';

      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId: randomUUID(),
          messageType: 'account.opened.v1',
          payload: { customerId: randomUUID(), accountNumber, accountType: 'SAVINGS' },
        }),
        notification: null,
        now: NOW,
      });

      const leaked = await pool.query(`SELECT 1 FROM audit_events WHERE payload::text LIKE $1`, [
        `%${accountNumber}%`,
      ]);

      // Today's behaviour, not the desired one. See the comment above.
      expect(leaked.rowCount).toBe(1);
    });

    it('keeps a non-sensitive field intact, so the deny-list is not simply emptying every payload', async () => {
      const transactionId = randomUUID();
      const correlationId = randomUUID();

      await repository.record({
        event: arriving({
          eventId: randomUUID(),
          correlationId,
          payload: { transactionId, status: 'COMPLETED' },
        }),
        notification: null,
        now: NOW,
      });

      const stored = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM audit_events WHERE correlation_id = $1`,
        [correlationId],
      );

      expect(stored.rows[0]?.payload['transactionId']).toBe(transactionId);
      expect(stored.rows[0]?.payload['status']).toBe('COMPLETED');
    });
  });

  /**
   * Constraints not already exercised above — each one an assertion a mocked
   * repository could be made to *claim* it enforces without a real
   * `CHECK`/`UNIQUE` in front of it.
   */
  describe('constraints enforced by the database itself', () => {
    it('rejects a processing_status the schema does not know at the database', async () => {
      await expect(
        pool.query(
          `INSERT INTO audit_events
             (event_id, message_type, message_version, producer, occurred_at, received_at,
              correlation_id, causation_id, payload, processing_status, consumer)
           VALUES ($1, 'transaction.completed.v1', 1, 'transaction-service', $2, $2, $3, NULL,
                   '{}'::JSONB, 'NOT-A-STATUS', 'audit.transaction')`,
          [randomUUID(), NOW, randomUUID()],
        ),
      ).rejects.toThrow();
    });

    it('rejects a notification severity the schema does not know at the database', async () => {
      await expect(
        pool.query(
          `INSERT INTO notifications
             (notification_id, type, channel, subject, status, correlation_id, created_at, severity)
           VALUES ($1, 'transfer.completed', 'EMAIL', 'subject', 'PENDING', $2, $3, 'NOT-A-SEVERITY')`,
          [randomUUID(), randomUUID(), NOW],
        ),
      ).rejects.toThrow();
    });

    it('rejects a SENT notification with no processed_at — a settled row must carry when', async () => {
      await expect(
        pool.query(
          `INSERT INTO notifications
             (notification_id, type, channel, subject, status, correlation_id, created_at, processed_at)
           VALUES ($1, 'transfer.completed', 'EMAIL', 'subject', 'SENT', $2, $3, NULL)`,
          [randomUUID(), randomUUID(), NOW],
        ),
      ).rejects.toThrow();
    });

    it('rejects a PENDING notification that already carries a processed_at', async () => {
      await expect(
        pool.query(
          `INSERT INTO notifications
             (notification_id, type, channel, subject, status, correlation_id, created_at, processed_at)
           VALUES ($1, 'transfer.completed', 'EMAIL', 'subject', 'PENDING', $2, $3, $3)`,
          [randomUUID(), randomUUID(), NOW],
        ),
      ).rejects.toThrow();
    });

    /** The other half of criterion 2: one event causes at most one notification. */
    it('rejects a second notification for the same (caused_by, type) pair', async () => {
      const causedBy = randomUUID();
      const correlationId = randomUUID();

      await pool.query(
        `INSERT INTO notifications
           (notification_id, type, channel, subject, status, correlation_id, caused_by, created_at)
         VALUES ($1, 'transfer.completed', 'EMAIL', 'subject', 'PENDING', $2, $3, $4)`,
        [randomUUID(), correlationId, causedBy, NOW],
      );

      await expect(
        pool.query(
          `INSERT INTO notifications
             (notification_id, type, channel, subject, status, correlation_id, caused_by, created_at)
           VALUES ($1, 'transfer.completed', 'EMAIL', 'subject', 'PENDING', $2, $3, $4)`,
          [randomUUID(), correlationId, causedBy, NOW],
        ),
      ).rejects.toThrow();
    });
  });
});
