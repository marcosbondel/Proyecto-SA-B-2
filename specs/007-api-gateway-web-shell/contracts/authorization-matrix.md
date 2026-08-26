# Matriz de autorización: D-06 proyectada sobre las rutas

**Fase 1** · 2026-08-24 · [plan.md](../plan.md) ·
fuente: [`docs/domain/actors.md`](../../../docs/domain/actors.md) (decisión D-06)

Esta matriz **no decide nada nuevo**. Proyecta D-06, que ya está aprobada, sobre
las once rutas del Gateway. Si las dos divergen, D-06 tiene razón y esta tabla
está mal.

---

## Ruta → roles

| Ruta | Pública | `CLIENTE` | `CAJERO_RECEPTOR` | `ADMINISTRADOR` |
| --- | :---: | :---: | :---: | :---: |
| `POST /api/auth/login` | ✔ | — | — | — |
| `POST /api/customers` | ✔ | — | — | — |
| `GET /api/customers/verify-email` | ✔ | — | — | — |
| `GET /health` · `GET /ready` | ✔ | — | — | — |
| `PATCH /api/customers/:customerId` | ✘ | ✔ | ✔ | ✔ |
| `POST /api/accounts` | ✘ | ✔ | ✔ | ✔ |
| `GET /api/accounts/:accountId/balance` | ✘ | ✔ | ✔ | ✔ |
| `POST /api/transfers` | ✘ | ✔ | ✔ | ✔ |
| `GET /api/transfers/:transactionId` | ✘ | ✔ | ✔ | ✔ |
| `GET /api/audit` | ✘ | ✘ | ✘ | ✔ |

**`GET /api/audit` es la única ruta que un rol tiene prohibida.** D-06 lo dice
sin ambigüedad: "Read the audit record and notifications — ✘ ✘ ✔". Es, por tanto,
la ruta con la que se prueba el `403` de SC-003 y del criterio 10 del ticket.

---

## Por qué las otras seis no se restringen más

D-06 restringe casi todo por **alcance**, no por rol: "✔ own only", "✔ own
accounts", "✔ from own accounts". El alcance depende de quién es dueño de qué, y
**el Gateway no lo puede saber**: no tiene base de datos y no conoce la propiedad
de las cuentas.

De modo que la frontera se reparte así, y conviene decirlo explícitamente porque
es donde alguien va a querer añadir lógica de negocio al Gateway:

| Pregunta | Quién la responde |
| --- | --- |
| ¿Este rol puede llamar esta ruta? | **El Gateway** — es esta tabla |
| ¿Este actor puede operar sobre este sujeto? | **El servicio dueño**, con su código nombrado |

Un `CLIENTE` que consulte el saldo de una cuenta ajena atraviesa el Gateway y es
rechazado por Account Service. Eso no es un agujero: es la única división posible
cuando el punto de entrada no tiene datos, y la spec lo fija en sus casos límite.

Las filas de D-06 que no aparecen arriba —validar la foto del documento,
activar o desactivar una cuenta a mano, asignar roles— **no tienen ruta en
T-15**. Llegan con T-16 a T-20 y heredarán esta misma tabla.

---

## Navegación del frontend

Deriva de la misma matriz. Vive en `app/lib/navigation.ts` como dato puro, para
que sea verificable sin navegador (R9).

| Módulo | `CLIENTE` | `CAJERO_RECEPTOR` | `ADMINISTRADOR` |
| --- | :---: | :---: | :---: |
| Clientes | ✔ | ✔ | ✔ |
| Cuentas | ✔ | ✔ | ✔ |
| Transferencias | ✔ | ✔ | ✔ |
| Auditoría | ✘ | ✘ | ✔ |

Un `CLIENTE` o un `CAJERO_RECEPTOR` no ven Auditoría en el menú, y escribir
`/auditoria` directamente tampoco la renderiza (FR-041e).

### Esto no es un control de seguridad

Ocultar una ruta es **comodidad**: no ofrecer un botón que va a fallar. La
prohibición la aplica el Gateway, y la aplica igual (FR-041f).

La prueba que lo demuestra es deliberadamente incómoda: llamar `GET /api/audit`
con un token de `CLIENTE` **sin pasar por el navegador**, y obtener `403`. Si esa
prueba solo se ejecutara a través de la interfaz, estaría midiendo el menú en vez
de la autorización.

---

## Invariantes

1. Toda ruta no listada como pública **exige token**. Sin él, `401`, y no se
   publica nada (FR-014, FR-009).
2. `401` y `403` son **resultados distintos**, nunca intercambiables (FR-010).
3. La identidad del sobre sale **siempre** del token, jamás del cuerpo (FR-012).
4. Ninguna petición rechazada por autenticación o autorización llega al broker
   (SC-004).
5. Esta tabla y `app/lib/navigation.ts` derivan de la misma fuente. **Una prueba
   debe fallar si divergen.**
