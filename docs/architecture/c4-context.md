# C4 Nivel 1 — Diagrama de Contexto del Sistema

Este documento describe el **Nivel 1 (Contexto)** de la arquitectura C4 para **Bank USAC**. Establece el límite perimetral del sistema bancario, los roles de usuarios humanos que interactúan con él y los sistemas externos de soporte.

---

## 1. Diagrama de Contexto

![C4 Contexto — Bank USAC](diagrams/02-c4-contexto.png)

Fuentes de diagramación versionadas:
* [PlantUML (`.puml`)](diagrams/02-c4-contexto.puml)

---

## 2. Elementos del Contexto

### Actores Primarios (Izquierda)
* **Cliente (`CLIENTE`)**: Usuario final del banco. Consulta saldos, realiza transferencias entre cuentas propias y a terceros, paga facturas de servicios y revisa su buzón de notificaciones.
* **Cajero Receptor (`CAJERO_RECEPTOR`)**: Personal operativo de agencia. Valida los documentos de identidad (DPI) en mesa de control, abre cuentas bancarias a nombre de clientes verificados y recibe depósitos en efectivo en ventanilla.
* **Administrador (`ADMINISTRADOR`)**: Personal de gestión y seguridad. Supervisa la auditoría global del banco filtrada por trazabilidad (`correlationId`), administra el estado de cuentas y gestiona incidencias operativas.

### Límite del Sistema: Bank USAC
* **API Gateway (`NestJS`)**: Punto perimetral único de entrada HTTPS/REST. Autentica tokens JWT, valida autorizaciones RBAC y mapea peticiones hacia colas y tópicos RabbitMQ con un techo estricto de respuesta de 5 segundos.
* **Núcleo Bancario (Microservicios)**: Conjunto de servicios de dominio desacoplados (`Customer`, `Account`, `Transaction`, `Payment`, `Notification & Audit`) que operan bajo mensajería asíncrona AMQP.

### Sistemas Externos Secundarios (Derecha)
* **Proveedor de Pagos / Biller**: Sistema externo de recaudación y cobros que autoriza o declina pagos de servicios mediante APIs externas y reintentos escalonados.
* **Servicio de Correo Electrónico (Resend / Simulado)**: Canal externo de comunicación encargado de la entrega de enlaces de activación de cuenta, códigos de recuperación y notificaciones bancarias.
