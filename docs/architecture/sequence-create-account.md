# Diagrama de Secuencia UML — Creación de Cuenta Bancaria

Este documento describe la secuencia de interacción asíncrona y orquestación de mensajes para la **Apertura de una Cuenta Bancaria** en Bank USAC.

---

## 1. Diagrama de Secuencia

![Secuencia — Crear Cuenta](diagrams/06-uml-secuencia-crear-cuenta.png)

Fuentes de diagramación versionadas:
* [PlantUML (`.puml`)](diagrams/06-uml-secuencia-crear-cuenta.puml)

---

## 2. Flujo del Proceso

1. **Solicitud de Apertura**:
   * El actor autorizado (`CAJERO_RECEPTOR` o `ADMINISTRADOR`) envía una solicitud `POST /api/accounts` al API Gateway especificando el `customerId` (cuya identidad fue previamente validada en mesa de control) y el tipo de cuenta (`MONETARIA` o `AHORRO`).
2. **Generación de Metadatos en Gateway**:
   * El Gateway valida la sesión JWT, inyecta el `correlationId` para trazabilidad y la `Idempotency-Key`.
   * Publica el comando `account.create.v1` sobre el exchange de RabbitMQ.
3. **Procesamiento en Account Service**:
   * Consume el comando y verifica la unicidad de idempotencia en `processed_messages`.
   * Valida la elegibilidad del rol (regla C-6: solo clientes pueden ser titulares de cuenta).
   * Genera el número de cuenta determinista y persistente.
   * Inserta la fila en la tabla `accounts` con balance inicial de `Q 0.00` y estado `ACTIVE`.
4. **Publicación del Evento**:
   * Account Service publica el evento `account.opened.v1` con el ID de la cuenta creada.
5. **Auditoría y Notificación**:
   * `Notification & Audit Service` consume el evento, redacta los datos sensibles, almacena el registro en `audit_events` y encola la notificación de bienvenida para el cliente.
6. **Respuesta al Cliente**:
   * El Gateway retorna `201 Created` con el identificador y datos de la cuenta abierta.
