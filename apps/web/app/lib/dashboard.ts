import type { Role } from './navigation.ts';
import type { WireMoney } from './account.ts';

/**
 * What `GET /api/dashboard` answers — five sections, each independently
 * `null`.
 *
 * `null` is not "zero". It means that service did not answer in time, or
 * refused, or is restarting; a tile that showed `0` for an unanswered question
 * would be a wrong number rather than a missing one, and on this screen a wrong
 * number is worse.
 */
export interface CustomerStats {
  readonly registered: number;
  readonly pendingValidation: number;
  readonly activatedToday: number;
}

export interface AccountStats {
  readonly active: number;
  readonly inactive: number;
  readonly openedToday: number;
  readonly depositsToday: number;
  readonly depositedToday: WireMoney;
}

export interface TransferStats {
  readonly today: number;
  readonly completedToday: number;
  readonly failedToday: number;
  readonly compensatedToday: number;
  readonly inFlight: number;
}

export interface PaymentStats {
  readonly today: number;
  readonly succeededToday: number;
  readonly failedToday: number;
  readonly retrying: number;
}

export interface AuditStats {
  readonly eventsToday: number;
  readonly invalidToday: number;
  readonly notificationsToday: number;
  readonly lastEventType: string | null;
  readonly lastEventAt: string | null;
}

export interface Dashboard {
  readonly customers: CustomerStats | null;
  readonly accounts: AccountStats | null;
  readonly transfers: TransferStats | null;
  readonly payments: PaymentStats | null;
  readonly audit: AuditStats | null;
}

/**
 * Which dashboard a role gets.
 *
 * Three landing pages behind one route, chosen here rather than by three routes,
 * because "where do I land" must not be a URL somebody can be sent to by
 * mistake. A `CLIENTE` who opens `/` gets their money; staff get their work.
 */
export type DashboardKind = 'CLIENT' | 'TELLER' | 'ADMIN';

export function dashboardFor(role: Role | null): DashboardKind | null {
  if (role === null) {
    return null;
  }

  return { CLIENTE: 'CLIENT', CAJERO_RECEPTOR: 'TELLER', ADMINISTRADOR: 'ADMIN' }[
    role
  ] as DashboardKind;
}

/**
 * An operational alert worth putting at the top of `D-02`.
 *
 * Derived from the counts rather than sent by anybody, and deliberately so: an
 * "alerts" endpoint would be a fourth place where somebody decides what counts
 * as wrong, and this way the rule is one function anyone can read and test.
 *
 * The three are ordered by how much they cost if ignored. Money in flight is
 * first because a transfer stuck after its debit is money that has left an
 * account and not arrived; a compensation is second because it is over and the
 * customer has their money back but is owed an explanation; a message the trail
 * could not parse is third because nothing is lost, only unexplained.
 */
export interface Alert {
  readonly severity: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly title: string;
  readonly detail: string;
  readonly to: string;
}

export function alertsFrom(dashboard: Dashboard): readonly Alert[] {
  const alerts: Alert[] = [];

  if (dashboard.transfers !== null && dashboard.transfers.inFlight > 0) {
    alerts.push({
      severity: 'HIGH',
      title: `${String(dashboard.transfers.inFlight)} transferencias en vuelo`,
      detail:
        'Aceptadas, debitando o esperando el pago. Las que ya pasaron el débito tienen dinero ' +
        'fuera de toda cuenta hasta que la transferencia cierre.',
      to: '/transferencias/monitor',
    });
  }

  if (dashboard.payments !== null && dashboard.payments.retrying > 0) {
    alerts.push({
      severity: 'HIGH',
      title: `${String(dashboard.payments.retrying)} pagos reintentando`,
      detail:
        'Fallaron al menos una vez y tienen otro intento pendiente. No requieren reproceso ' +
        'manual: la escalera de reintentos sigue corriendo sola.',
      to: '/pagos/monitor',
    });
  }

  if (dashboard.transfers !== null && dashboard.transfers.compensatedToday > 0) {
    alerts.push({
      severity: 'MEDIUM',
      title: `${String(dashboard.transfers.compensatedToday)} transferencias compensadas hoy`,
      detail:
        'El dinero salió y volvió. Cada una deja dos movimientos en el estado de cuenta del ' +
        'cliente, que probablemente los vea antes que nosotros.',
      to: '/transferencias/monitor',
    });
  }

  if (dashboard.audit !== null && dashboard.audit.invalidToday > 0) {
    alerts.push({
      severity: 'LOW',
      title: `${String(dashboard.audit.invalidToday)} mensajes inválidos hoy`,
      detail:
        'El servicio de auditoría no pudo interpretarlos y los registró como INVALID en vez de ' +
        'descartarlos. No se perdió nada; falta explicarlos.',
      to: '/auditoria',
    });
  }

  return alerts;
}

/** Whether every section came back empty — a dashboard with nothing to draw. */
export function isBlank(dashboard: Dashboard): boolean {
  return (
    dashboard.customers === null &&
    dashboard.accounts === null &&
    dashboard.transfers === null &&
    dashboard.payments === null &&
    dashboard.audit === null
  );
}
