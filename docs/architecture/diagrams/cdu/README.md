# Casos de uso de Bank USAC

La carpeta sigue la forma solicitada por el auxiliar. No se modelan tres o más
descomposiciones anidadas: el microservicio aparece como una función principal
del sistema y, dentro de esa función, se enumeran sus funcionalidades como
casos de uso relacionados.

## Lectura de los diagramas

1. `00-alto-nivel` muestra `CDU000`, el objetivo general de Bank USAC.
2. `01-primera-descomposicion` muestra `CDU001` a `CDU005`. Cada uno representa
   la función principal de un microservicio.
3. Cada carpeta de microservicio contiene un diagrama detallado. Sus casos
   siguen la numeración del CDU principal: `CDU001.1`, `CDU001.2`, etc.
4. `flujos/` contiene diagramas de actividad para los casos de uso principales.
   Los comportamientos incluidos, como validar credenciales o persistir una
   auditoría, se muestran dentro del caso principal que los reutiliza.

La numeración no debe interpretarse como `CDU001.1.1`: no existe una tercera
descomposición. Los sufijos identifican funcionalidades del CDU del
microservicio.

## Matriz de CDUs

| CDU | Función principal | Microservicio |
| --- | --- | --- |
| CDU000 | Gestionar operaciones bancarias | Bank USAC |
| CDU001 | Gestionar clientes e identidad | Customer Service |
| CDU002 | Gestionar cuentas y saldos | Account Service |
| CDU003 | Gestionar transferencias | Transaction Service |
| CDU004 | Gestionar pagos | Payment Service |
| CDU005 | Gestionar notificaciones y auditoría | Notification & Audit Service |

## Funcionalidades principales

- `CDU001`: registrar cliente, activar cliente por correo, iniciar sesión,
  actualizar datos, cargar fotografía, validar identidad, recuperar la
  contraseña por correo y cambiar la contraseña propia.
- `CDU002`: abrir cuenta, consultar saldo, aplicar movimiento de Saga,
  gestionar estado de cuenta, desactivar cuentas inactivas y registrar un depósito en ventanilla.
- `CDU003`: transferir fondos, consultar el estado de una transferencia y
  consultar el historial de transferencias con filtros.
- `CDU004`: procesar pagos y consultar el historial de pagos.
- `CDU005`: registrar auditoría, enviar notificaciones y consultar auditoría o
  notificaciones.

## Qué significa cada notación

- Un **diagrama de casos de uso** muestra objetivos y funcionalidades asociadas
  con actores. `<<include>>` representa comportamiento obligatorio reutilizado;
  `<<extend>>` representa comportamiento opcional o alternativo.
- Un **diagrama de actividad** muestra el flujo principal, decisiones, errores
  y resultados de un caso de uso. Es el equivalente a los diagramas de flujo
  mostrados en clase.
- PlantUML conserva las fuentes semánticas versionadas de estos diagramas.
  Las fuentes Mermaid que ADR-013 pedía junto a ellas se retiraron el
  2026-09-02. La política del 2026-10-22 pide edición nativa de los casos de uso
  en Lucid y entrega sólo en PNG; los PUML permiten cotejar su contenido.
  [ADR-024](../../adr/ADR-024-native-lucid-and-png-delivery.md) registra el
  cambio y la [auditoría T-61](../../../qa/T-61-documentation-audit.md) conserva
  el estado de revisión y exportación. Las actividades conservan PUML como
  fuente; la existencia de un PNG no certifica que proceda de Lucid.

## Fuente funcional

Los casos se derivan de:

- `docs/domain/actors.md` — actores y permisos.
- `docs/domain/use-cases.md` — seis flujos de negocio y la Saga.
- `docs/domain/message-catalog.md` — comandos y eventos por servicio.
- `docs/domain/bounded-contexts.md` — responsabilidades y límites.
- `context/prompt-mockup.md` — superficies funcionales del frontend,
  solamente cuando no contradicen el modelo de dominio.

El **depósito en ventanilla sí se modela** (`CDU002.9`): existe en el código
como `POST /api/accounts/{accountId}/deposit`, restringido a `CAJERO_RECEPTOR` y
`ADMINISTRADOR`, y `docs/domain/actors.md` le da su propia fila de permisos. El
**retiro de efectivo no**: no existe en el sistema. La validación de fondos
pertenece a Account Service; Transaction Service solicita el movimiento y
conserva el estado de la Saga.

El **pago de servicios no tiene caso propio a propósito**. En el código es
`CDU003.1 Transferir fondos` con una `reference`: el prestador tiene su cuenta
recaudadora en este banco, así que pagar la luz es una transferencia a esa
cuenta con el número de contrato. Un caso separado describiría un mecanismo que
no existe.

## Los archivos

Cada diagrama tiene su fuente PlantUML versionada y el PNG que se entrega.

### Nivel del sistema

| CDU | Diagrama | Fuente | Render |
| --- | --- | --- | --- |
| CDU000 | Objetivo general de Bank USAC | [`.puml`](00-alto-nivel.puml) | [`.png`](00-alto-nivel.png) |
| CDU001–005 | Primera descomposición por microservicio | [`.puml`](01-primera-descomposicion.puml) | [`.png`](01-primera-descomposicion.png) |

### CDU001 — Customer Service

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU001 | **Diagrama de casos de uso del servicio** | [`.puml`](customer/customer-casos-de-uso.puml) | [`.png`](customer/customer-casos-de-uso.png) |
| CDU001.1 | Registrar cliente | [`.puml`](customer/flujos/CDU001.1-registrar-cliente.puml) | [`.png`](customer/flujos/CDU001.1-registrar-cliente.png) |
| CDU001.2 | Activar cliente por correo | [`.puml`](customer/flujos/CDU001.2-activar-cliente.puml) | [`.png`](customer/flujos/CDU001.2-activar-cliente.png) |
| CDU001.3 | Iniciar sesión | [`.puml`](customer/flujos/CDU001.3-iniciar-sesion.puml) | [`.png`](customer/flujos/CDU001.3-iniciar-sesion.png) |
| CDU001.4 | Actualizar datos personales | [`.puml`](customer/flujos/CDU001.4-actualizar-datos.puml) | [`.png`](customer/flujos/CDU001.4-actualizar-datos.png) |
| CDU001.5 | Cargar fotografía del DPI | [`.puml`](customer/flujos/CDU001.5-cargar-fotografia.puml) | [`.png`](customer/flujos/CDU001.5-cargar-fotografia.png) |
| CDU001.6 | Validar identidad en ventanilla | [`.puml`](customer/flujos/CDU001.6-validar-identidad.puml) | [`.png`](customer/flujos/CDU001.6-validar-identidad.png) |
| CDU001.11 | Solicitar restablecimiento de contraseña | [`.puml`](customer/flujos/CDU001.11-solicitar-restablecimiento.puml) | [`.png`](customer/flujos/CDU001.11-solicitar-restablecimiento.png) |
| CDU001.12 | Restablecer contraseña con el enlace | [`.puml`](customer/flujos/CDU001.12-restablecer-contrasena.puml) | [`.png`](customer/flujos/CDU001.12-restablecer-contrasena.png) |
| CDU001.13 | Cambiar la contraseña propia | [`.puml`](customer/flujos/CDU001.13-cambiar-contrasena.puml) | [`.png`](customer/flujos/CDU001.13-cambiar-contrasena.png) |

### CDU002 — Account Service

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU002 | **Diagrama de casos de uso del servicio** | [`.puml`](account/account-casos-de-uso.puml) | [`.png`](account/account-casos-de-uso.png) |
| CDU002.1 | Abrir cuenta | [`.puml`](account/flujos/CDU002.1-abrir-cuenta.puml) | [`.png`](account/flujos/CDU002.1-abrir-cuenta.png) |
| CDU002.2 | Consultar saldo | [`.puml`](account/flujos/CDU002.2-consultar-saldo.puml) | [`.png`](account/flujos/CDU002.2-consultar-saldo.png) |
| CDU002.3 | Aplicar movimiento de la Saga | [`.puml`](account/flujos/CDU002.3-aplicar-movimiento.puml) | [`.png`](account/flujos/CDU002.3-aplicar-movimiento.png) |
| CDU002.4 | Gestionar estado de la cuenta | [`.puml`](account/flujos/CDU002.4-gestionar-estado.puml) | [`.png`](account/flujos/CDU002.4-gestionar-estado.png) |
| CDU002.8 | Desactivar cuentas inactivas | [`.puml`](account/flujos/CDU002.8-desactivar-cuentas-inactivas.puml) | [`.png`](account/flujos/CDU002.8-desactivar-cuentas-inactivas.png) |
| CDU002.9 | Registrar depósito en ventanilla | [`.puml`](account/flujos/CDU002.9-registrar-deposito.puml) | [`.png`](account/flujos/CDU002.9-registrar-deposito.png) |

### CDU003 — Transaction Service

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU003 | **Diagrama de casos de uso del servicio** | [`.puml`](transaction/transaction-casos-de-uso.puml) | [`.png`](transaction/transaction-casos-de-uso.png) |
| CDU003.1 | Transferir fondos | [`.puml`](transaction/flujos/CDU003.1-transferir-fondos.puml) | [`.png`](transaction/flujos/CDU003.1-transferir-fondos.png) |
| CDU003.2 | Consultar estado de la transferencia | [`.puml`](transaction/flujos/CDU003.2-consultar-estado.puml) | [`.png`](transaction/flujos/CDU003.2-consultar-estado.png) |
| CDU003.10 | Consultar historial con filtros | [`.puml`](transaction/flujos/CDU003.10-consultar-historial.puml) | [`.png`](transaction/flujos/CDU003.10-consultar-historial.png) |

### CDU004 — Payment Service

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU004 | **Diagrama de casos de uso del servicio** | [`.puml`](payment/payment-casos-de-uso.puml) | [`.png`](payment/payment-casos-de-uso.png) |
| CDU004.1 | Procesar pago | [`.puml`](payment/flujos/CDU004.1-procesar-pago.puml) | [`.png`](payment/flujos/CDU004.1-procesar-pago.png) |
| CDU004.2 | Consultar historial de pagos | [`.puml`](payment/flujos/CDU004.2-consultar-historial.puml) | [`.png`](payment/flujos/CDU004.2-consultar-historial.png) |

### CDU005 — Notification & Audit Service

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU005 | **Diagrama de casos de uso del servicio** | [`.puml`](notification-audit/notification-audit-casos-de-uso.puml) | [`.png`](notification-audit/notification-audit-casos-de-uso.png) |
| CDU005.1 | Registrar evento de auditoría | [`.puml`](notification-audit/flujos/CDU005.1-registrar-auditoria.puml) | [`.png`](notification-audit/flujos/CDU005.1-registrar-auditoria.png) |
| CDU005.2 | Enviar notificación | [`.puml`](notification-audit/flujos/CDU005.2-enviar-notificacion.puml) | [`.png`](notification-audit/flujos/CDU005.2-enviar-notificacion.png) |
| CDU005.3 | Consultar la bitácora de auditoría | [`.puml`](notification-audit/flujos/CDU005.3-consultar-auditoria.puml) | [`.png`](notification-audit/flujos/CDU005.3-consultar-auditoria.png) |
| CDU005.4 | Bandeja propia por rol y consola de entregas sólo administrador | [`.puml`](notification-audit/flujos/CDU005.4-consultar-notificaciones.puml) | [`.png`](notification-audit/flujos/CDU005.4-consultar-notificaciones.png) |

### CDU-F3 — Casos de uso de Fase III (Interbancario, Anomalías, Simulación y Observabilidad)

| CDU | Caso de uso | Fuente | Render |
| --- | --- | --- | --- |
| CDU-F3 | **Diagrama de casos de uso de Fase III** | [`.puml`](fase3/fase3-casos-de-uso.puml) | [`.png`](fase3/fase3-casos-de-uso.png) |
| CDU-F3.1 | Enviar depósito interbancario | [`.puml`](fase3/flujos/CDU-F3.1-enviar-deposito-interbancario.puml) | [`.png`](fase3/flujos/CDU-F3.1-enviar-deposito-interbancario.png) |
| CDU-F3.2 | Recibir depósito interbancario | [`.puml`](fase3/flujos/CDU-F3.2-recibir-deposito-interbancario.puml) | [`.png`](fase3/flujos/CDU-F3.2-recibir-deposito-interbancario.png) |
| CDU-F3.3 | Conciliación diaria y liquidación de reversos | [`.puml`](fase3/flujos/CDU-F3.3-conciliar-interbancario.puml) | [`.png`](fase3/flujos/CDU-F3.3-conciliar-interbancario.png) |
| CDU-F3.4 | Detección y reporte de anomalías N/M | [`.puml`](fase3/flujos/CDU-F3.4-reportar-anomalia-nm.puml) | [`.png`](fase3/flujos/CDU-F3.4-reportar-anomalia-nm.png) |
| CDU-F3.5 | Configuración de simulación de pagos en caliente | [`.puml`](fase3/flujos/CDU-F3.5-configurar-simulacion-pagos.puml) | [`.png`](fase3/flujos/CDU-F3.5-configurar-simulacion-pagos.png) |
| CDU-F3.6 | Diagnóstico SRE con dashboards, trazas y alertas SLO | [`.puml`](fase3/flujos/CDU-F3.6-diagnostico-observabilidad-sre.puml) | [`.png`](fase3/flujos/CDU-F3.6-diagnostico-observabilidad-sre.png) |

## Revisión Fase III — T-61

Las 37 fuentes y sus PNG se revisaron manteniendo su estilo azul: depósito
Ahorro Q100, comisión Q3 por débito, dedup de auditoría por consumidor,
registro INVALID y redacción antes de insertar, canales reales/simulados y
monitor Payment sólo para personal. Las etiquetas de mensajes llevan `.v1`.
La nota tecnológica identifica la implementación sin sustituir el flujo de
negocio. Las extensiones interbancarias, anomalía y SRE se encuentran integradas
con sus flujos en [CDU-F3](fase3/fase3-casos-de-uso.png) y [casos actuales](../../../domain/use-cases.md).
