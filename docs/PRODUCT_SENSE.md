# Product Sense

Revisión T-61, 21 de octubre de 2026. Esta descripción refleja los flujos
implementados; las decisiones formales y sus restricciones están en el
[dominio](domain/README.md), [caso de negocio](dda.md) y [ADR](architecture/adr/README.md).

## Product North Star

La documentación de T-01 dejó pendiente una declaración breve aprobada por el
equipo. No se inventa una aprobación retroactiva. Como síntesis operativa del
producto actual: una persona debe poder saber qué ocurrió con su dinero y
obtener asistencia usando el código de una operación.

El éxito se observa en estados y movimientos persistidos, permisos aplicados y
evidencia de seguimiento. No se deduce del primer `202` ni de un dashboard sin
datos.

## Users

| Persona o sistema | Necesidad y alcance |
| --- | --- |
| Cliente | Registro, acceso, identidad, cuentas propias, envío interno e interbancario, pagos y avisos personales. |
| Cajero receptor | Atención presencial, alta de clientes, validación documental, cuentas, depósitos y monitoreo operativo. |
| Administrador | Alta de personal, auditoría global, notificaciones y supervisión del banco. |
| Banco externo | Protocolo interbancario autenticado, idempotencia y resolución verificable. |
| Operador SRE | Métricas, logs, trazas, SLO, alertas y runbooks, con acceso independiente a Grafana. |

Una misma persona puede participar en varios trabajos, pero una sesión bancaria
solo lleva uno de los tres roles. Los permisos de Grafana no provienen del JWT
del banco.

## Core Workflows

1. Registrarse, activar el correo y validar la identidad. La activación y el KYC
   son estados independientes; el registro presencial tiene su propio camino.
2. Abrir una cuenta Monetaria o Ahorro, consultar saldo y movimientos, depositar
   en ventanilla y gestionar su estado con motivo.
3. Transferir entre cuentas mediante Saga, distinguir rechazo previo al débito
   de devolución compensatoria y verificar la comisión cuando corresponda.
4. Pagar a un facturador mediante su cuenta recaudadora y consultar los intentos
   del proveedor.
5. Enviar a otro banco y seguir sus seis estados y reversos. TIMEOUT no acredita
   ni devuelve por sí solo: conserva reserva durante la reconciliación.
6. Consultar avisos propios y estado de lectura; el Administrador puede revisar
   entregas, auditoría por correlación y filtros globales.
7. Investigar mediante código de seguimiento, traza, logs y métricas. Medir SLO y
   budget en una ventana real antes de declarar cumplimiento.

Los [manuales](manual/README.md) describen las rutas y pasos actuales. La
[guía de validación](qa/guia-validacion-manual-fase3.md) separa el comportamiento
observado del que solo se ha contrastado con el código.

## Product Principles

- Mostrar aceptación, resultado incierto y resolución como hechos distintos.
- Explicar si el dinero sigue reservado, llegó o fue devuelto.
- Mantener las decisiones de fondos y autorización en el servicio dueño.
- Dar identificadores útiles sin exponer documentos, tokens ni credenciales.
- Seguir [DESIGN](DESIGN.md) y registrar desviaciones de su referencia.
- Preservar evidencia negativa: una lista vacía, un timeout o una traza ausente
  no deben transformarse en éxito.

## Scope Boundary

El sistema es una implementación académica de banca distribuida. La simulación
del depósito de apertura y del proveedor no acredita conexiones financieras
reales. Hay integración HTTP interbancaria y entrega real de los correos
autorizados cuando está configurada.

No existe retiro de efectivo, cambio de correo en pantalla ni editor de
facturadores. Las pruebas de fallos y carga corresponden a entornos aislados de
validación; los endpoints públicos no autorizan por sí solos a modificar datos.
