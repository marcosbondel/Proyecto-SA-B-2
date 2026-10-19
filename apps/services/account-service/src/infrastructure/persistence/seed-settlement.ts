import { INTERBANK_SETTLEMENT_ACCOUNT_ID } from '@bank/contracts';
import type { Pool } from 'pg';

/**
 * La cuenta de liquidación interbancaria, creada al arrancar (T-47).
 *
 * Mismo trato que las cuentas de recaudación de los billers, y por los mismos
 * motivos: es **dato de producto y no de demostración** —un banco que opera
 * depósitos interbancarios tiene esta cuenta esté o no demostrando algo—, su
 * identificador es fijo para que quien la necesita no tenga que preguntar, y el
 * `UPSERT` toca sólo las columnas del catálogo: un reinicio nunca el saldo,
 * porque aquí hay dinero real en cuanto alguien manda un depósito.
 *
 * El `customerId` es sintético y sin clave ajena (§8.2, 2.3). Existe para que
 * la columna siga siendo `NOT NULL`, y tiene el efecto de que esta cuenta no
 * aparezca en el listado de nadie: el listado es por cliente y nadie entra
 * como ese identificador. Tampoco lleva `biller_code`, así que no sale en el
 * desplegable de pago de servicios.
 *
 * **Qué representa el saldo.** Lo que este banco le debe al banco pareja por
 * los depósitos que ya salieron de las cuentas de sus clientes y que el otro
 * banco aceptó. Un rechazo o un vencimiento lo deshacen, porque la Saga
 * compensa las dos patas. Conciliarlo contra lo que el otro banco dice haber
 * recibido es el reporte diario que §4.1 deja como opcional.
 */
const SYSTEM_CUSTOMER_ID = 'c0000000-0000-4000-8000-0000000000ff';

/** Crea o refresca la cuenta de liquidación. Devuelve su identificador. */
export async function seedSettlementAccount(pool: Pool): Promise<string> {
  await pool.query(
    `INSERT INTO accounts
       (account_id, customer_id, account_type, balance, status)
     VALUES ($1, $2, 'MONETARIA', 0.00, 'ACTIVE')
     ON CONFLICT (account_id) DO UPDATE
       SET status = 'ACTIVE'
     -- Reactiva si hace falta y no escribe si no; el saldo, que recibe los
     -- reembolsos, no se toca jamás desde el arranque (T-60, QA 20).
     WHERE accounts.status <> 'ACTIVE'`,
    [INTERBANK_SETTLEMENT_ACCOUNT_ID, SYSTEM_CUSTOMER_ID],
  );

  return INTERBANK_SETTLEMENT_ACCOUNT_ID;
}
