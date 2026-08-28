# Quickstart: validar T-15 de punta a punta

**Fase 1** · 2026-08-24 · [plan.md](plan.md) · [spec.md](spec.md)

Cómo comprobar que la feature hace lo que la spec dice. Es una guía de
validación, no de implementación: los pasos de construcción viven en `tasks.md`.

Los cinco servicios de dominio **no existen todavía**. Todo lo que espera
respuesta se valida contra respondedores simulados que publican sobre el
RabbitMQ real de T-06.

---

## Prerrequisitos

```bash
node --version   # 24.19.0 (.nvmrc)
pnpm --version   # 11.21.0
```

Desde la **raíz del repositorio**, nunca desde una carpeta de aplicación:

```bash
pnpm install
pnpm build        # los paquetes compartidos se consumen desde dist/
```

Levantar la infraestructura de T-06 (RabbitMQ y MinIO) según
[`specs/006-local-dev-infra/quickstart.md`](../006-local-dev-infra/quickstart.md).
Comprobar antes de seguir:

- RabbitMQ responde en `localhost:5672`, administración en `localhost:15672`.
- MinIO responde en `localhost:9000` y el bucket
  `customer-identity-documents` existe.

Copiar y rellenar el entorno del Gateway:

```bash
cp apps/gateway/.env.example apps/gateway/.env
```

Las variables nuevas están en [`data-model.md`](data-model.md) §10. **No debe
existir ninguna `DATABASE_URL`**: su ausencia es un entregable.

---

## Comprobaciones que no necesitan nada levantado

```bash
pnpm lint            # estilo y, sobre todo, las reglas de aislamiento por capas
pnpm typecheck
pnpm test            # unitarias de las siete aplicaciones
pnpm test:contract    # el catálogo, incluida la enmienda paymentScenario
```

`pnpm lint` es el que importa: falla ante un import cruzado entre servicios, un
framework en `domain`, `infrastructure` dentro de `application` o `interfaces`, o
código de servicio dentro del Gateway. Si bloquea algo, el diseño está mal.

---

## SC-007 · El Gateway no tiene base de datos ni clientes HTTP internos

Es el criterio 4 del ticket y se comprueba sin ejecutar nada.

```bash
# Cero resultados esperados
grep -rEn 'DATABASE_URL|postgres://|typeorm|prisma|\bpg\b' apps/gateway/src apps/gateway/.env.example

# Cero resultados esperados
grep -rEn 'axios|node-fetch|\bgot\b|http://(customer|account|transaction|payment|notification)' apps/gateway/src

# Y en las dependencias declaradas
grep -E '"(pg|typeorm|prisma|axios|node-fetch|got)"' apps/gateway/package.json
```

Los tres deben devolver **nada**. Que `@aws-sdk/client-s3` sí aparezca es
correcto: es el almacenamiento de objetos de ADR-012, no una base de datos.

---

## Levantar

```bash
pnpm --filter gateway dev     # http://localhost:3000
pnpm --filter web dev         # http://localhost:3000/… (Nuxt elige otro puerto)
```

Salud:

```bash
curl -s localhost:3000/health
curl -s localhost:3000/ready   # este sí exige broker conectado
```

---

## SC-001 · Cada ruta publica el mensaje correcto

Abrir la administración de RabbitMQ en `localhost:15672`, exchange
`bank.commands`. Llamar cada ruta y confirmar **nombre exacto** del mensaje,
clave de enrutamiento y `correlationId` idéntico al que devolvió el HTTP.

```bash
# Registro con foto
curl -i -X POST localhost:3000/api/customers \
  -F fullName='Ana López' -F identityDocument='1234567890101' \
  -F email='ana@example.com' -F dateOfBirth='1995-04-12' \
  -F address='Zona 1, Guatemala' -F role='CLIENTE' \
  -F credential='una-contrasena-larga' \
  -F photo=@docs/references/sample-id.jpg
# Espera 202 con customerId y correlationId
```

Confirmar en el broker que el mensaje es `customer.register.v1` y que **lleva
solo la referencia** de la foto —`objectKey`, `contentType`, `sizeBytes`,
`sha256`—, jamás los bytes. El objeto debe estar en MinIO con esa clave.

Repetir para las ocho rutas restantes contra la tabla de
[`contracts/http-routes.md`](contracts/http-routes.md).

---

## SC-004 · Una petición rechazada no publica nada

La comprobación más importante y la más fácil de olvidar. Anotar el contador de
mensajes del exchange, provocar cada rechazo, y confirmar que **no subió**.

```bash
curl -i -X POST localhost:3000/api/transfers \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"sourceAccount":"a","targetAccount":"a","amount":{"amountMinor":-1,"currency":"GTQ"}}'
# 400, nombra el campo culpable, y el contador no se movió
```

Provocar también: sin token (`401`), con firma alterada (`401`), caducado
(`401`), y `CLIENTE` contra `/api/audit` (`403`). Ninguno publica.

---

## SC-002 y criterio 9 · Los tres rechazos de inicio de sesión son idénticos

```bash
curl -i -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","credential":"incorrecta"}'
```

Comparar **cuerpo, código y cabeceras** entre los tres casos: contraseña
incorrecta, correo inexistente, y cuenta con `activationPending: true`. Deben
ser indistinguibles.

Comprobar además que `credential` **no aparece en ningún log** del Gateway.

---

## SC-003 y criterio 10 · Autenticación y autorización

`/api/audit` es la única ruta que D-06 restringe, así que es la que ejercita el
`403`:

```bash
curl -i "localhost:3000/api/audit?correlationId=<uuid>" -H 'Authorization: Bearer <token-CLIENTE>'
# 403, distinto del 401

curl -i "localhost:3000/api/audit?correlationId=<uuid>"
# 401, sin publicar nada
```

**Esta comprobación se hace sin navegador, a propósito.** Hacerla a través de la
interfaz mediría el menú, no la autorización.

---

## SC-005 y criterio 2 · El plazo de cinco segundos

Apagar el respondedor simulado y consultar un saldo. Debe responder `504` a los
cinco segundos, con el `correlationId` intacto y un mensaje que diga
explícitamente que la operación **no fue cancelada**.

Comprobar que no quedan esperas acumuladas: tras mil consultas vencidas,
`ReplyRegistry.pendingCount` vuelve a cero.

Publicar después una respuesta tardía para esa correlación: se descarta en
silencio y no rompe nada.

> Las pruebas automatizadas inyectan `setTimeoutFn` — ninguna duerme cinco
> segundos reales.

---

## SC-012 y criterio 11 · Verificación de correo

Los cuatro desenlaces:

```bash
curl -i "localhost:3000/api/customers/verify-email?token=<válido>"     # 200, ACTIVE
curl -i "localhost:3000/api/customers/verify-email?token=<usado>"      # 409 genérico
curl -i "localhost:3000/api/customers/verify-email?token=<caducado>"   # 409, idéntico al anterior
curl -i "localhost:3000/api/customers/verify-email?token=abc"          # 400, sin publicar
```

Con el respondedor apagado: `504`, no `409`. Confundir silencio con rechazo
dejaría cuentas activas cuyo dueño cree que no lo están.

Confirmar en el broker que `customer.email.verified.v1` **sigue llegando a
`audit.all`**: que el Gateway lo observe no lo quita de la auditoría.

Con dos instancias del Gateway levantadas, comprobar que el evento llega a las
dos colas exclusivas y que solo la que esperaba responde.

---

## SC-013 · `paymentScenario`

```bash
# Los tres valores viajan intactos
-d '{"…","paymentScenario":"TRANSIENT_FAILURE"}'   # 202, el valor está en el mensaje
# Un cuarto valor
-d '{"…","paymentScenario":"MAYBE"}'                # 400, sin publicar
# Sin el campo
-d '{"…"}'                                          # 202, camino normal
```

La retrocompatibilidad se prueba además en `pnpm test:contract`: un mensaje que
omite el campo sigue validando y la versión sigue siendo `.v1`.

---

## SC-006 y criterio 3 · Los cinco errores

Provocar los cinco y comparar contra
[`contracts/error-contract.md`](contracts/error-contract.md):

| Tipo | Cómo provocarlo |
| --- | --- |
| `VALIDATION_ERROR` | Campo obligatorio ausente |
| `BUSINESS_REJECTION` | Respondedor simulado que devuelve `INSUFFICIENT_FUNDS` |
| `REPLY_TIMEOUT` | Respondedor apagado |
| `BROKER_UNAVAILABLE` | `docker stop` a RabbitMQ y llamar cualquier ruta |
| `INTERNAL_ERROR` | MinIO apagado y registrar con foto |

En los cinco: `correlationId` presente, y **ningún** rastro de pila, cadena de
conexión, credencial, nombre de bucket ni nombre de servicio interno.

Con el broker caído, confirmar además que quedó un **registro correlacionado** en
el log del Gateway (FR-029).

---

## SC-010 y criterio 5 · El contrato OpenAPI

```bash
pnpm --filter gateway test -- openapi
```

Dos aserciones: el YAML versionado coincide con el que produce el código (si no,
alguien cambió una ruta y no regeneró), y cada ruta nombra un mensaje que existe
en `catalog` de `@bank/contracts`.

---

## SC-008, SC-014, SC-015 · El shell

```bash
pnpm --filter web dev
```

1. Sin sesión, cualquier módulo lleva a `/login`. Registro y verificación de
   correo siguen alcanzables.
2. Iniciar sesión con cada uno de los tres roles y comparar la navegación con
   [`contracts/authorization-matrix.md`](contracts/authorization-matrix.md):
   `CLIENTE` y `CAJERO_RECEPTOR` **no ven Auditoría**; `ADMINISTRADOR` sí.
3. Escribir `/auditoria` con sesión de `CLIENTE`: no se renderiza.
4. Los cuatro módulos abren con su título, aunque sean esqueletos.
5. Con el token caducado, una llamada protegida descarta la sesión y lleva a
   `/login`, de forma distinguible de un rechazo de negocio.

```bash
pnpm --filter web test   # normalización de errores, moneda, y la matriz de navegación
```

La comprobación de que **ningún módulo necesita código de sesión** (SC-015) es
una búsqueda: `useState('token')`, `localStorage`, `Authorization` no deben
aparecer fuera de `app/composables/` y `app/lib/`.

---

## SC-009 · Las cuatro piezas compartidas

Existen y su lógica está cubierta por prueba automatizada sobre `app/lib/`, sin
broker:

- Los **cinco** estados de `SharedAsyncStateAlert`, el de broker no disponible
  incluido.
- `SharedCorrelationIdBadge` con su acción de copiar.
- `SharedMoneyInput` rechazando menos de un centavo y más de dos decimales.
- `SharedIdempotencyKeyField` conservando la clave entre reintentos.

---

## Evidencia a recoger

| Qué | Para qué criterio |
| --- | --- |
| Salida de las pruebas de las once rutas, plazo, correlación y broker caído | Evidencia esperada del ticket |
| Capturas de la administración de RabbitMQ con los mensajes observados | ídem |
| Capturas del shell: navegación de los tres roles, inicio de sesión, las dos resoluciones de activación | 6, 7, 8 |
| Salida de las tres búsquedas estáticas | 4 · SC-007 |
| Nota de revisión visual contra `bonking.dc.html`, nombrando las tres discrepancias del plan | `docs/DESIGN.md` |

---

## Comparación visual obligatoria

Cada captura del shell se compara con su entrada en `bonking.dc.html`
(proyecto `4a48d652-297f-4351-9170-d8049427e897`). La nota de revisión debe
nombrar las tres discrepancias que el plan ya registró:

1. **Paleta** — resuelta: se implementa la de Claude Design y `docs/DESIGN.md`
   se actualiza.
2. **Rechazo de inicio de sesión** — el prototipo separa "cuenta no activa"; la
   spec exige rechazo genérico y gana la spec.
3. **Broker no disponible** — no existe en el prototipo; se compone en su mismo
   idioma como adición intencional.
