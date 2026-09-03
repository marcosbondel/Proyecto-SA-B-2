# Contratos de Eventos y Envolvente Estándar — Bank USAC

Este documento define la estructura de la **Envolvente Estándar (`Envelope`)** y los principios de contrato que rigen todos los mensajes en Bank USAC, garantizando interoperabilidad, observabilidad e idempotencia.

---

## 1. La Envolvente Canónica (`Envelope<T>`)

Todo mensaje (comando o evento) viaja dentro de un sobre inmutable con metadatos de transporte y trazabilidad:

```typescript
export interface Envelope<T = unknown> {
  readonly messageId: string;       // UUID v4 único del mensaje (eventId)
  readonly messageType: string;     // Identificador de tipo (ej. "account.debited.v1")
  readonly version: number;         // Versión del schema (entero positivo >= 1)
  readonly producer: string;        // Servicio emisor (ej. "account-service")
  readonly timestamp: string;       // ISO 8601 en UTC del momento de emisión
  readonly correlationId: string;   // Identificador transversal de la operación
  readonly causationId?: string;    // ID del mensaje previo que desencadenó este
  readonly idempotencyKey: string;  // Llave única para deduplicación
  readonly payload: T;              // Datos de negocio validados con schema Zod
}
```

---

## 2. Garantías de los Metadatos

1. **`correlationId` (Trazabilidad Transversal)**:
   * Es acuñado exclusivamente por el API Gateway al recibir la petición HTTP externa.
   * Se propaga inalterado a lo largo de toda la Saga, permitiendo reconstruir la historia completa de un flujo con un simple filtro en la base de datos de auditoría.
2. **`idempotencyKey` (Deduplicación)**:
   * Proporcionado por el cliente o generado de forma determinista.
   * Cada microservicio inserta este valor en su tabla `processed_messages` con constraint único `(idempotency_key, message_type)` **antes** de modificar cualquier dato de negocio.
3. **`causationId` (Cadena Causal)**:
   * Identifica el `messageId` del mensaje inmediatamente anterior que causó la publicación del nuevo mensaje, construyendo un grafo causal acíclico.
4. **Validación en Tiempo de Ejecución**:
   * Implementada en el paquete compartido `@bank/contracts` mediante librerías **Zod**.
   * Cualquier mensaje que viole el esquema del contrato es rechazado inmediatamente antes de alcanzar la lógica de dominio.
