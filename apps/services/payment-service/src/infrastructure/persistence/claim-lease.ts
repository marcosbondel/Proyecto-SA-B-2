/**
 * Cuánto dura el arrendamiento de una fila reclamada por un barrido (T-60).
 *
 * Un reclamo es «elegir las filas vencidas sin arrendar y arrendarlas» en una
 * sola sentencia; el arrendamiento es `claimed_until`, y mientras no caduque
 * ninguna otra réplica ni ningún otro barrido toca la fila. Quien termina el
 * paso la suelta (`claimed_until = NULL`) en el mismo `UPDATE` que programa el
 * siguiente, así que la duración sólo importa en dos casos: el pod murió a
 * medias (la fila espera el arrendamiento entero) y el paso tardó más que él
 * (otra réplica la repite).
 *
 * Hay que elegirlo **más largo que el peor caso de procesar un lote**, porque
 * el lote se reclama entero al principio y se procesa en serie: la fila 20 espera
 * a las 19 anteriores.
 *
 * - Envíos al banco pareja: lote de 20 (`SWEEP_BATCH`) × 5 s de tiempo límite
 *   HTTP (`HttpPartnerBankClient`) = 100 s con el otro banco caído del todo. 120 s.
 * - Callbacks que este banco manda: 20 × 3 s (`HttpPartnerCallback`) = 60 s. 90 s,
 *   porque el barrido toma los callbacks de depósitos y los de conflictos uno
 *   tras otro y cada reclamo debe poder con su lote entero.
 * - Pagos simulados (la escalera de reintentos): no hay red; un intento dura
 *   milisegundos salvo la latencia simulada que un operador pida, y si un
 *   arrendamiento caduca a medias, `attempt` lo absorbe (fila bloqueada y número
 *   de intento comprobado: el segundo es un `SUPERSEDED`). 30 s, que además acota
 *   cuánto se retrasa un reintento si el pod muere —o el intento en línea
 *   lanza— con la fila en la mano: la escalera es de 1 s, 5 s y 30 s.
 *
 * Es la ventana que paga una caída, no el camino normal, y se puede cambiar por
 * repositorio (segundo argumento del constructor) sin tocar el SQL.
 */
export const SEND_LEASE_MS = 120_000;
export const CALLBACK_LEASE_MS = 90_000;
export const PAYMENT_LEASE_MS = 30_000;
