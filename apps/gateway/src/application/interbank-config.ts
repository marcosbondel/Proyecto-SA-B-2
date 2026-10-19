/**
 * Lo que la capa de aplicación necesita saber de la configuración interbancaria,
 * como tokens de inyección (T-60). Viven aquí y no junto a los controladores
 * porque la aplicación no puede importar de las interfaces: las dependencias
 * apuntan hacia adentro.
 */

/** El código de banco propio, del ConfigMap. `GET /health` lo publica. */
export const INTERBANK_BANK_CODE = Symbol('InterbankBankCode');

/** El código del banco pareja configurado, al que este banco sabe enviar. */
export const INTERBANK_PARTNER_BANK_CODE = Symbol('InterbankPartnerBankCode');

/**
 * El límite por operación, en centavos: uno solo para recibir y para enviar
 * (B7). El techo es el del contrato (Q10 000,00).
 */
export const INTERBANK_MAX_AMOUNT_MINOR = Symbol('InterbankMaxAmountMinor');
