# Patrón Saga — Orquestación de Transferencias y Compensación Contable

Este documento describe la arquitectura y comportamiento del patrón **Saga Coreografiada** implementado en Bank USAC para garantizar la consistencia eventual entre microservicios sin transacciones distribuidas en dos fases (2PC).

---

## 1. Máquina de Estados de la Transacción

`Transaction Service` gestiona una máquina de estados estricta y determinista que transiciona bajo bloqueos pesimistas (`SELECT ... FOR UPDATE`):

```
                     ┌──────────────┐
                     │   PENDING    │
                     └──────┬───────┘
                            │ (account.debit.v1)
                            ▼
                     ┌──────────────┐
                     │   DEBITING   │
                     └──────┬───────┘
                            │ (account.debited.v1)
                            ▼
                     ┌──────────────┐
                     │PAYMENT_PENDING
                     └──────┬───────┘
              ┌─────────────┴─────────────┐
              │ (payment.succeeded.v1)    │ (payment.failed.v1 / error)
              ▼                           ▼
       ┌──────────────┐            ┌──────────────┐
       │  COMPLETED   │            │  COMPENSATED │
       └──────────────┘            └──────────────┘
```

---

## 2. Los Seis Estados y sus Transiciones Válidas

1. **`PENDING`**: La transferencia ha sido aceptada por el Gateway (`202 Accepted`) y registrada en la base de datos. Se encola el comando de débito.
2. **`DEBITING`**: El comando de débito está en tránsito hacia `Account Service`.
3. **`PAYMENT_PENDING`**: El débito de la cuenta de origen fue aplicado exitosamente. Se solicita la ejecución del pago o crédito.
4. **`COMPLETED`**: Estado terminal exitoso. El cobro fue aprobado y la cuenta de destino fue acreditada.
5. **`FAILED`**: Estado terminal de fallo. Ocurre cuando el débito inicial es rechazado por falta de fondos o cuenta inactiva (sin movimiento de dinero).
6. **`COMPENSATED`**: Estado terminal de compensación. Si el dinero ya había sido debitado de la cuenta de origen pero el pago posterior falló definitivamente, se ejecuta una operación contable de compensación (`COMPENSATION`) que reintegra los fondos a la cuenta de origen.

---

## 3. Garantía de la Compensación como Hecho Contable

En Bank USAC, la compensación no es un cambio cosmético de estado:
* `Account Service` inserta un registro formal en `account_operations` con tipo `COMPENSATION` y monto positivo.
* El saldo de la cuenta de origen se incrementa mediante cálculo exacto en centavos.
* La suite de integración automatizada `pnpm images:flow` valida que el saldo antes de la transferencia y el saldo después de una compensación sean **matemáticamente idénticos**.
