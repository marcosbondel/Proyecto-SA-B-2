# Contract — Qué debe contener cada documento del modelo

**Feature**: [../spec.md](../spec.md) | **Fecha**: 2026-08-14

Este contrato hace verificable la regla de trazabilidad de FR-052: cada documento declara qué
secciones son obligatorias, qué afirmaciones tiene prohibidas y cuál es su fuente autorizada.
Un documento entregado sin una sección obligatoria, o con una afirmación prohibida, no cumple
aunque esté bien escrito.

Todos van en **inglés** (R2), bajo `docs/domain/`.

---

## `docs/domain/README.md`

**Secciones obligatorias**

1. Qué es este modelo y qué no es — contrato funcional, no diseño de clases (nota del ticket).
2. Índice de los cinco documentos restantes, con una línea de cuándo leer cada uno.
3. Glosario del lenguaje ubicuo, con la equivalencia español ↔ inglés (data-model §6).
4. Decisiones del equipo D-01 a D-06, cada una con su alternativa descartada.
5. Regla de cambio: modificar el modelo exige nueva aprobación y revisión de los tickets
   dependientes (FR-056).
6. Registro de aprobación: los tres integrantes, con fecha y versión aprobada (FR-055).

**Prohibido**: declarar aprobado el modelo antes de que las tres firmas existan.

**Fuente**: spec §"Decisiones del equipo", research R1 y R2, data-model §6.

---

## `docs/domain/bounded-contexts.md`

**Secciones obligatorias**

1. Los cinco contextos con su responsabilidad única, y el API Gateway sin entidades ni base de
   datos (FR-001, FR-006).
2. Matriz de ownership por atributo: propietario, consumidores, medio (FR-002, FR-003).
3. Propiedad frente a referencia: qué significa guardar un `customerId` ajeno (FR-004).
4. Datos que no pueden cruzar límites, con el motivo de cada uno (FR-005).
5. La excepción acotada del correo de activación, con su justificación (FR-041a, R12).
6. La regla de que ningún servicio consulta la base de otro, y qué se penaliza (FR-007, FR-024).

**Prohibido**: describir cualquier lectura de un servicio sobre datos de otro; nombrar tablas,
esquemas o motores de base de datos; asignar un atributo a dos propietarios.

**Fuente**: enunciado §4.1 y §4.2 (reglas de diseño obligatorias, p. 7), data-model §1 y §2.

---

## `docs/domain/entities.md`

**Secciones obligatorias**

1. Una sección por entidad — `Customer`, `Account`, `Transaction`, `Payment`, `AuditEvent`,
   `Notification` — cada una con identificador, atributos, estados posibles, transiciones
   legales como conjunto cerrado, e invariantes con su fallo esperado (FR-008 a FR-015, FR-025).
2. Las invariantes transversales, con el servicio que protege cada una (data-model §4).
3. La independencia explícita entre `emailVerifiedAt` e `identityStatus` (FR-010).
4. Las reglas de dinero: quetzales, dos decimales exactos, rechazo sin redondeo (FR-026, R9).

**Prohibido**: prescribir tipos de dato de un lenguaje, nombres de columna, índices o
migraciones; presentar `accountType` con reglas diferenciadas (D-02 las descarta para Fase 1);
dejar una transición sin declarar legal o ilegal.

**Fuente**: enunciado §4.1 (datos por servicio, pp. 5-7), ticket (modelo mínimo e invariantes
obligatorias), data-model §3 y §4, research R5 a R10.

---

## `docs/domain/actors.md`

**Secciones obligatorias**

1. Los tres actores del enunciado con su definición (FR-042).
2. La decisión D-01: son `Customer` con `role`, no una entidad de personal separada, con las
   invariantes que aplican solo a `CLIENTE` (FR-043, FR-043a, FR-043b).
3. Matriz caso de uso × rol (data-model §5).
4. Frontera explícita de lo que cada rol **no** puede hacer, incluido el rechazo del cliente
   sobre cuentas ajenas (FR-044).
5. Marca visible de que los permisos son propuesta del equipo, no requisito del enunciado
   (FR-045), y remisión a T-13 para la autorización granular (FR-058).

**Prohibido**: presentar los permisos como derivados del enunciado; definir autorización por
endpoint, alcance de token o reglas de sesión.

**Fuente**: enunciado §4.1 (nota de los tres tipos de usuario, p. 7), data-model §5.

---

## `docs/domain/use-cases.md`

**Secciones obligatorias**

Un registro por cada uno de los seis flujos — crear cliente, crear cuenta, consultar saldo,
transferir, activación por correo, login — y cada registro con:

1. Actor y precondiciones.
2. Entrada.
3. Resultado observable y postcondiciones.
4. Secuencia de servicios y mensajes, referida al catálogo.
5. Al menos un fallo esperado, con su rechazo o su compensación (FR-038).

Más dos secciones transversales:

6. La Saga de transferencia completa con sus siete pasos y sus dos caminos de compensación
   (FR-033, FR-039, R11), incluida la distinción entre `FAILED` y `COMPENSATED`.
7. La propagación del `correlationId` de extremo a extremo (FR-040).

**Prohibido**: describir una llamada síncrona entre servicios; hacer que el Gateway tome una
decisión de dominio; dejar un flujo distribuido sin compensación; especificar la emisión,
firma o expiración del JWT (FR-036, es T-03).

**Fuente**: enunciado §4.2 (casos de uso obligatorios y diagramas de secuencia), §6 pasos 1, 2
y 6, ticket (flujo de negocio mínimo), research R11.

---

## `docs/domain/message-catalog.md`

**Secciones obligatorias**

1. Convención comando/evento (FR-046).
2. Tabla de comandos: emisor, servicio que lo atiende, flujo (FR-048).
3. Tabla de eventos por servicio productor: consumidores y flujo (FR-047).
4. La declaración de que Notification & Audit no publica eventos consumidos para decisiones de
   negocio (FR-050).
5. La frontera con T-05, escrita (FR-051, R3).

**Prohibido**: definir forma de payload, campos, versionado, nombres de exchange o routing
key, política de reintentos del broker, o formato de serialización.

**Fuente**: [message-catalog.md](message-catalog.md) de este directorio, enunciado §6 paso 4.

---

## Documentos existentes que se editan

Ninguno se reescribe. Solo los cambios listados (R14).

| Archivo | Cambio permitido | Prohibido |
| --- | --- | --- |
| `ARCHITECTURE.md` | Completar los datos poseídos en la tabla de servicios y enlazar `docs/domain/` | Tocar las ocho restricciones no negociables; duplicar el modelo aquí |
| `AGENTS.md` | Añadir `docs/domain/` al índice de documentación del proyecto | Alterar el enlace permanente a `docs/DESIGN.md` (FR-032 de T-01) |
| `docs/DOC_INVENTORY.md` | Clasificar los seis archivos nuevos con responsable | Reclasificar documentos ajenos a este trabajo |
| `docs/events/README.md` | Acotar la nota de bloqueo a payload, versionado y topics; enlazar el catálogo | Declarar el catálogo de eventos completo — no lo está hasta T-05 |
| `docs/architecture/README.md` | Enlazar `docs/domain/use-cases.md` como los registros de casos de uso que prometía | Declarar entregados los diagramas o los ADR — son T-07 y T-03 |

---

## Reglas que aplican a los seis documentos

| # | Regla | Origen |
| --- | --- | --- |
| D-R1 | Toda decisión es rastreable al enunciado, a una decisión registrada o a una aprobación nombrada | FR-052 |
| D-R2 | Lo que el enunciado no define se marca como decisión del equipo, nunca como requisito del enunciado | FR-053 |
| D-R3 | Cero marcadores `TBD`, `TODO` o `to be defined` sin responsable y justificación | Convención de T-01, FR-017 de T-01 |
| D-R4 | Cero código, esquemas, contratos de mensaje o clases concretas | FR-057, nota del ticket |
| D-R5 | Prosa en inglés; literales del enunciado en español | R2 |
| D-R6 | Cada documento enlaza a los otros por ruta relativa, no duplica su contenido | Evita divergencia |
