/**
 * How an amount of money is written on the wire.
 *
 * A transport shape and nothing more: no arithmetic, no rounding policy, no
 * currency rules. Whoever owns the data decides what an amount may be; this
 * only fixes how it is spelled so five services spell it the same way.
 */
export interface MoneyDto {
  /**
   * Amount in minor units — cents for GTQ and USD. Integer on purpose:
   * floating-point money is a defect waiting for a reconciliation report.
   */
  readonly amountMinor: number;

  /** ISO-4217 alphabetic code, uppercase. For example `GTQ`. */
  readonly currency: string;
}

/**
 * Example transport payload, kept so the package compiles with something real
 * in it and so consumers have an import to point at.
 *
 * > **Blocked**: The payloads of the actual domain messages are not defined yet. Owner: Marcos Bonifasi. Arrives with: T-05.
 */
export interface AmountQuotedDto {
  readonly reference: string;
  readonly total: MoneyDto;
}
