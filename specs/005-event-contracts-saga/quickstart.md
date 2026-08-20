# Quickstart: verificar T-05

**Fase 1** · Feature `005-event-contracts-saga` · 2026-08-19

Cómo comprobar que la feature está hecha, criterio por criterio. Todo se ejecuta desde la
**raíz del repositorio**, nunca desde el directorio de una aplicación.

## Lo que aquí no se puede verificar

**No hay broker en ejecución.** T-06 es quien levanta RabbitMQ y MinIO, y no está hecho. Por
tanto esta guía verifica los contratos, la validación y la topología **como declaración**, no
como comportamiento observado contra un broker vivo. Las comprobaciones que exigen un broker
—que un mensaje recorra realmente 1 s, 5 s y 30 s, que acabe en la DLQ, que una respuesta
vuelva a la cola exclusiva— quedan registradas al final y son de **T-06** y **T-23**.

Decirlo importa: afirmar que el reintento funciona sin haberlo visto funcionar sería
exactamente el tipo de afirmación que `verification-before-completion` existe para impedir.

## Requisitos previos

```bash
node --version   # 24.19.0, el de .nvmrc
pnpm --version   # 11.21.0
pnpm install
pnpm build       # obligatorio: los paquetes compartidos se consumen desde dist/
```

---

## 1. La suite completa

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:contract
pnpm typecheck
pnpm format:check
```

**Esperado**: los seis en código de salida 0.

`pnpm typecheck` es nuevo y no es decorativo: **jest no comprueba tipos**, así que `pnpm test`
pasaba con errores de tipo en archivos de prueba. Eso escondió cinco pruebas obsoletas de los
servicios durante esta feature. Sin este comando, la suite miente. `pnpm test:contract` deja de ser una prueba del
sobre y pasa a ejercitar los 42 contratos.

`pnpm lint` es el que más dice: sus reglas de aislamiento son ejecutables. Si un archivo de
`src/domain/**` importara `@bank/contracts`, fallaría aquí — que es la comprobación de
**SC-010**.

---

## 2. Criterio por criterio

| # | Criterio | Cómo se comprueba | Esperado |
| --- | --- | --- | --- |
| SC-001 | 42 contratos | `find apps/packages/contracts/src/events -name '*.v1.ts' \| wc -l` | 42 |
| SC-001 | Coherencia con T-02 | `pnpm test:contract` — `catalog-completeness.spec.ts` lee los nombres de `docs/domain/message-catalog.md` | 35 leídos, 35 contratados, 7 añadidos declarados |
| SC-002 | Implementable sin preguntar | Revisión: un integrante ajeno al diseño toma un mensaje y responde productor, consumidores, campos, error y versión sólo con `docs/events/` | Sin preguntas abiertas |
| SC-003 | Cadena causal reconstruible | `node --test` sobre el ejemplo de camino feliz: encadenar por `causationId` desde el último mensaje hasta el primero | Cadena de 7, sin huecos |
| SC-004 | 6 escenarios de la Saga | `grep -c '^### ' docs/events/saga-transfer.md` | ≥ 6, uno por escenario |
| SC-005 | Un efecto por reentrega | Prueba unitaria: mismo `idempotencyKey` dos veces sobre un paso que mueve dinero | Un solo efecto |
| SC-006 | Mensaje inválido, cero cambios | `pnpm test:contract` — casos válido e inválido por contrato | Inválido rechazado, sin efecto |
| SC-007 | Cero colas compartidas | Revisar la tabla de `docs/events/topology.md` contra los 7 consumidores lógicos | 7 colas, 0 compartidas |
| SC-008 | Máximo 4 entregas | Revisión de los argumentos declarados: 3 colas de reintento + DLQ por cola | 1 + 3 = 4 |
| SC-009 | Cero secretos en mensajes | `grep -rniE '(password|token|secret|jwt|base64)' apps/packages/contracts/src/events/` | Sin coincidencias en campos de payload |
| SC-009a | Payloads ≤ 64 KB | Prueba: serializar cada ejemplo y medir | Todos por debajo |
| SC-010 | Dominio sin contratos | `pnpm lint` | Exit 0 |

---

## 3. Coherencia con lo que T-02 cerró

Estas son las comprobaciones que evitan que T-05 contradiga en silencio al ticket del que
depende.

```bash
# Los 35 nombres de T-02 tienen contrato, con el sufijo de versión.
# Cada nombre de la tabla de docs/domain/message-catalog.md debe aparecer
# como archivo <nombre>.v1.ts bajo apps/packages/contracts/src/events/.

# Los 6 añadidos están declarados como ampliación, no colados en silencio.
grep -n "respuesta\|reply" docs/domain/message-catalog.md
```

**Esperado**: la nota de ampliación existe en `docs/domain/message-catalog.md`, declara
`reply` como tercera categoría y explica por qué una respuesta no es un evento huérfano.

**Comprobación de la secuencia de la Saga**: los siete pasos de `docs/events/saga-transfer.md`
deben coincidir uno a uno con la tabla de `docs/domain/use-cases.md` §6. En particular, el paso
4 dice que **Payment reacciona a `payment.requested.v1`**, no a `account.debited.v1`. Si
alguien "corrigió" esto siguiendo el texto del ticket, la Saga contradice a T-02 y al diagrama
que T-13 tendrá que dibujar.

---

## 4. Coherencia de la versión

La redundancia de FR-005 sólo vale si se comprueba:

- Todo `messageType` termina en `.vN`.
- El `messageVersion` del sobre coincide con ese `N`.
- El nombre del archivo del contrato coincide con ambos.
- La routing key documentada es el `messageType` literal.

Una discrepancia entre los cuatro es un mensaje inválido, y hay una prueba que lo demuestra.

---

## 5. Las marcas de bloqueo que deben desaparecer

```bash
grep -rn "Blocked" apps/packages/contracts/ docs/events/ | grep -v node_modules
```

**Esperado**: sin coincidencias. Las tres marcas que hoy nombran a T-05 —en
`contracts/src/events/README.md`, en `money.dto.ts` y en `docs/events/README.md`— se retiran.

`docs/operations/README.md` pierde **sólo** la parte de política por consumidor; conserva las
de T-06 y T-23. Los seis `src/application/README.md` **siguen bloqueados**: su contenido llega
con T-15 a T-20.

`docs/TECH_DEBT.md`: **TD-013 se cierra**. **TD-014 no** — exige un broker en ejecución.

---

## 6. Lo que queda pendiente de verificación real

| Comprobación | Necesita | Ticket |
| --- | --- | --- |
| El reintento espera de verdad 1 s, 5 s y 30 s | RabbitMQ vivo | T-06 |
| Un mensaje agotado llega a `Q.dlq` con sus cabeceras | RabbitMQ vivo | T-06 |
| Una respuesta vuelve a la cola exclusiva correcta | Gateway + broker | T-15 |
| El objeto de la foto se recupera y el SHA-256 cuadra | MinIO | T-06 |
| La Saga completa de punta a punta | Los cinco servicios | T-23 |

Ninguna de estas puede declararse aprobada en T-05. Declararlas sería falso.
