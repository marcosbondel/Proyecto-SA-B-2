/**
 * Los tokens de la configuración interbancaria viven en la capa de aplicación
 * (T-60), porque los casos de uso los necesitan y no pueden importar de las
 * interfaces. Se reexportan aquí para quien ya los pedía desde este archivo.
 */
export {
  INTERBANK_BANK_CODE,
  INTERBANK_ID_SECRET,
  INTERBANK_MAX_AMOUNT_MINOR,
  INTERBANK_PARTNER_BANK_CODE,
  INTERBANK_PARTNER_BANK_CODES,
} from '../application/interbank-config';
