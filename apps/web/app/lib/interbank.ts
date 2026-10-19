/**
 * Enviar un depósito al banco pareja, decidido aquí (T-47).
 *
 * Mismo trato que `transaction.ts` y por el mismo motivo (TD-010): lo que
 * decide algo es una función pura, probada con `node --test`, y el componente
 * sólo dibuja. Un formulario que valida dentro de un `.vue` es un formulario
 * cuyas reglas nadie puede ejecutar sin un navegador.
 *
 * Lo que este archivo **no** valida, a propósito:
 *
 * - **Si la cuenta existe en el otro banco.** No se puede saber desde aquí y no
 *   le toca: lo dirá el banco pareja en su callback, y hasta entonces el dinero
 *   está reservado, no entregado. Una interfaz que pretendiera saberlo
 *   rechazaría cuentas válidas el día que el otro banco cambie su formato.
 * - **Si el saldo alcanza.** Es el juicio de Account Service, hecho bajo
 *   bloqueo de fila, y cualquier cosa que esta pantalla calculara estaría
 *   vieja antes de dibujarse.
 * - **El identificador del depósito y su clave de idempotencia.** Los mina el
 *   Gateway. Si vinieran de aquí, serían adivinables desde fuera — y un
 *   identificador adivinable es uno que se puede colisionar a propósito, que es
 *   el depósito duplicado que el enunciado penaliza con la mitad de la nota.
 */

import { isUuidV4 } from './account.ts';

/** Lo que la pantalla tiene a medio llenar. */
export interface InterbankDraft {
  readonly sourceAccount: string;
  readonly destinationBankCode: string;
  readonly destinationAccount: string;
  readonly amountMinor: number | null;
}

/**
 * Los formatos que el contrato oficial fija, los mismos que el Gateway valida
 * con un `400` (T-60): el código de banco es `^BANK[0-9]{2}$` y la cuenta
 * `^[A-Za-z0-9-]{1,34}$`.
 *
 * Se repiten aquí en vez de importarse porque `app/lib/` no depende de
 * `@bank/contracts`: el navegador no debe cargar el catálogo de mensajes del
 * sistema para validar un campo de texto. El precio es que si el contrato
 * cambia hay dos sitios que tocar, y la prueba de abajo es la que lo recuerda.
 *
 * Antes se aceptaban formas más laxas (`^[A-Z][A-Z0-9_]{1,31}$`, hasta 64
 * caracteres) que ningún banco pareja habría aceptado: el formulario dejaba
 * pasar lo que el Gateway rechazaba, y el cliente se enteraba por un error en
 * vez de por un campo marcado.
 */
const BANK_CODE = /^BANK[0-9]{2}$/;
const PARTNER_ACCOUNT = /^[A-Za-z0-9-]{1,34}$/;

/** Lo máximo que el contrato acepta como número de cuenta del otro banco. */
export const MAX_PARTNER_ACCOUNT = 34;

/**
 * El techo por operación que fija el contrato: Q 10,000.00, en centavos.
 *
 * Es un **techo**, no necesariamente el límite vigente: el Gateway lo toma del
 * ConfigMap y puede ser más bajo. Aquí sólo se detiene lo que ninguna
 * configuración aceptaría; si el límite configurado es menor, el Gateway
 * contesta con un `400` que dice cuál es y la pantalla lo muestra tal cual.
 */
export const MAX_INTERBANK_AMOUNT_MINOR = 1_000_000;

export function interbankProblems(draft: InterbankDraft): Readonly<Record<string, string>> {
  const problems: Record<string, string> = {};
  const source = draft.sourceAccount.trim();
  const bank = draft.destinationBankCode.trim();
  const account = draft.destinationAccount.trim();

  if (!isUuidV4(source)) {
    problems.sourceAccount = 'Elige la cuenta de la que va a salir el dinero.';
  }

  if (bank.length === 0) {
    problems.destinationBankCode = 'Indica el código del banco de destino.';
  } else if (!BANK_CODE.test(bank)) {
    problems.destinationBankCode =
      'El código del banco es BANK seguido de dos dígitos, en mayúsculas y sin espacios. Por ejemplo BANK99.';
  }

  if (account.length === 0) {
    problems.destinationAccount = 'Indica la cuenta que va a recibir el dinero en el otro banco.';
  } else if (account.length > MAX_PARTNER_ACCOUNT) {
    problems.destinationAccount = `La cuenta de destino no puede pasar de ${String(MAX_PARTNER_ACCOUNT)} caracteres.`;
  } else if (!PARTNER_ACCOUNT.test(account)) {
    problems.destinationAccount =
      'La cuenta de destino sólo puede llevar letras, números y guiones, sin espacios ni otros símbolos.';
  }

  if (draft.amountMinor === null || !Number.isInteger(draft.amountMinor) || draft.amountMinor <= 0) {
    problems.amount = 'Ingresa un monto mayor que Q 0.00, con dos decimales como máximo.';
  } else if (draft.amountMinor > MAX_INTERBANK_AMOUNT_MINOR) {
    problems.amount = 'El monto máximo por depósito a otro banco es Q 10,000.00.';
  }

  return problems;
}

export function canSendInterbank(draft: InterbankDraft): boolean {
  return Object.keys(interbankProblems(draft)).length === 0;
}

/**
 * El cuerpo que espera `POST /api/interbank/transfers`.
 *
 * Nada más que lo que el cliente decide. La cuenta de liquidación, el
 * identificador del depósito y la clave de idempotencia los pone el Gateway, y
 * mandarlos desde aquí sería ofrecer a quien abra las herramientas del
 * navegador justo lo que no debe elegir.
 */
export function interbankRequestBody(draft: InterbankDraft): {
  readonly sourceAccount: string;
  readonly destinationBankCode: string;
  readonly destinationAccount: string;
  readonly amount: { readonly amountMinor: number; readonly currency: 'GTQ' };
} {
  return {
    sourceAccount: draft.sourceAccount.trim(),
    destinationBankCode: draft.destinationBankCode.trim(),
    destinationAccount: draft.destinationAccount.trim(),
    amount: { amountMinor: draft.amountMinor ?? 0, currency: 'GTQ' },
  };
}

/**
 * Qué decirle a alguien que acaba de mandar un depósito.
 *
 * Importa que no diga «enviado» ni «acreditado»: el `202` significa que la
 * transferencia se aceptó y el débito va a ocurrir, no que el otro banco haya
 * recibido nada. Decir lo contrario es cómo alguien da por hecho que su dinero
 * llegó y reclama al banco equivocado.
 */
export const INTERBANK_ACCEPTED_MESSAGE =
  'Depósito en curso. El banco de destino tiene que confirmarlo; si lo rechaza o no contesta, el dinero vuelve a tu cuenta automáticamente.';
