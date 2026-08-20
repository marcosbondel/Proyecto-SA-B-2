# Implementation Plan: Contratos de eventos y Saga de transferencias (T-05)

**Branch**: `feature/T-05` | **Date**: 2026-08-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-event-contracts-saga/spec.md`

## Summary

Llenar el hueco que hoy está marcado como bloqueado: **42 contratos de mensaje versionados**
en `apps/packages/contracts/src/events/`, su documentación en `docs/events/`, la **topología
del broker** con reintentos y cola de errores en `@bank/messaging`, y el **guion de la Saga**
de transferencia con sus dos finales y sus seis escenarios.

El trabajo no decide qué mensajes existen — T-02 lo cerró: 13 comandos, 22 eventos, cero
huérfanos — ni con qué broker ni con qué patrón — T-03 lo cerró: RabbitMQ, choreography con
compensación explícita, JWT sólo en el Gateway. Lo que falta es **la forma serializada**:
payloads, versiones, claves de enrutamiento, política de entrega y correlación de respuestas.
Esa es la última pieza de diseño antes de que tres personas implementen servicios en paralelo
sin inventar nombres.

Cuatro decisiones de Fase 0 gobiernan el resto, y están en [research.md](research.md):

- **Zod** como fuente única de cada contrato, con el tipo derivado por `z.infer` y el JSON
  Schema generado (R1). Sujeto a la comprobación OSV que el propio `pnpm-workspace.yaml` exige.
- **Reintentos por cola de consumidor con TTL**, no por exchange y sin plugins (R5). La imagen
  fijada `rabbitmq:4.3.4-management` no trae `rabbitmq_delayed_message_exchange`, y reencolar
  en el exchange reentregaría el mensaje a consumidores que ya lo procesaron bien.
- **Cola de respuestas exclusiva por instancia** (R7). Una cola compartida rompe en cuanto el
  Gateway tiene dos réplicas, y el sistema se despliega en Kubernetes.
- **Cuatro exchanges**, lo que obliga a corregir `infra/docker/README.md`, que hoy afirma que
  hay uno solo (R4).

## Technical Context

**Language/Version**: TypeScript 6.0.3 en modo estricto, Node 24.19.0. La prosa duradera de
`docs/` va en **inglés** (FR-020 de T-01); los artefactos bajo `specs/` siguen en español por
ser documentos de trabajo.

**Primary Dependencies**: **dos entradas nuevas de catálogo**: `zod` (ejecución) y
`zod-to-json-schema` (desarrollo). `pnpm-workspace.yaml` documenta su propia regla —consultar
OSV y ejecutar `pnpm audit` antes de añadir— y es una tarea del plan, no un trámite: si alguna
tiene vulnerabilidad abierta, se vuelve a R1 y se usa `class-validator`, que ya está en el
catálogo. `amqplib` y `amqp-connection-manager` no cambian de versión.

**Storage**: N/A para el ticket. Se **decide** MinIO como búfer de la foto del documento (R9),
pero no se provisiona: eso es T-06. Ninguna base de datos se toca.

**Testing**: Jest sobre `@bank/contracts` y `@bank/messaging`. `pnpm test:contract` deja de ser
una prueba del sobre y pasa a ejercitar los 42 contratos con un caso válido y uno inválido cada
uno. **No hay broker en ejecución**, así que el comportamiento de reintento y DLQ se verifica
como declaración, no como observación — ver [quickstart.md](quickstart.md) §6.

**Target Platform**: paquetes compartidos de un monorepo pnpm, consumidos por siete
aplicaciones. Lectores: los tres integrantes, quien implemente cada servicio en T-15 en
adelante, quien levante la infraestructura en T-06, y quien dibuje T-13.

**Project Type**: paquete de biblioteca más documentación. Cero servicios nuevos, cero
endpoints, cero manifiestos.

**Performance Goals**: N/A para el entregable. El único umbral que fija es de tamaño: ningún
payload supera 64 KB (SC-009a), que es lo que sostiene la decisión de sacar los bytes de la
foto del broker.

**Constraints**: cero lógica de negocio en `@bank/contracts` y cero nombres de negocio en
`@bank/messaging` — el límite que su `package.json` ya declara. Cero código en las capas
`domain` y `application` de los servicios: siguen vacías y bloqueadas hasta T-15. Cero
manifiestos de Compose o Kubernetes. Cero diagramas UML formales: el guion textual de la Saga
es de aquí, el diagrama de secuencia es **T-13**.

**Scale/Scope**: 42 contratos, 4 exchanges, 7 colas de trabajo, 28 colas de reintento y error,
6 escenarios de Saga documentados, 3 ejemplos JSON completos. Aproximadamente 50 archivos
nuevos en `apps/packages/contracts/`, 5 documentos nuevos en `docs/events/`, y 6 documentos
existentes editados.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Estado del gate (pre-Phase 0): CONFORME.** **Re-evaluado tras Fase 1: CONFORME, con una
justificación registrada** en Complexity Tracking.

La constitución exige un veredicto por principio aplicable. Un "no aplica" razonado es un
veredicto legítimo; el silencio no.

| # | Principio | Veredicto | Razón |
| --- | --- | --- | --- |
| I | Exactamente cinco microservicios | **Conforme** | No se añade ningún desplegable. MinIO es infraestructura, como PostgreSQL o RabbitMQ: no tiene dominio, no consume eventos y no decide nada |
| II | Una base por servicio, sin acceso cruzado | **Conforme, con nota** | Ver Complexity Tracking. MinIO es búfer de transferencia entre Gateway y Customer Service, no la base de un servicio: no guarda estado del negocio y nadie lo consulta para decidir. La fuente de verdad de la foto sigue siendo la base de Customer Service |
| III | Bases fuera del cluster | **No aplica aquí** | Este ticket no escribe manifiestos. Genera la obligación de que T-06 sitúe MinIO fuera del cluster, junto a los PostgreSQL |
| IV | Comunicación asíncrona únicamente | **Conforme — es el ticket que lo hace real** | Los 42 contratos son la interfaz entre servicios. Ningún servicio expone ni consume el HTTP de otro. El Gateway escribe en MinIO y Customer Service lee de él: ninguno de los dos llama al otro, y el almacenamiento no es un servicio del sistema |
| V | Gateway única entrada, sin lógica de negocio | **Conforme** | El Gateway publica comandos, firma el JWT y deposita el objeto. Calcular un SHA-256 es integridad de transporte, no decisión de dominio — y Customer Service lo recalcula, que es lo que impide que la comprobación del Gateway sea la que manda |
| VI | Saga con compensación | **Conforme — es el ticket que la especifica** | Siete pasos, dos finales, la ruta de compensación única para los dos fallos posteriores al débito, e invariante T-7 |
| VII | Despliegue local en Kubernetes | **No aplica aquí** | Sin manifiestos. Sí condiciona el diseño: la cola de respuestas es exclusiva por instancia **porque** en Kubernetes replicar es lo normal (R7) |
| VIII | SRE desde el diseño | **Conforme — es el ticket que lo concreta** | Idempotencia por clave, reintentos con backoff acotado, manejo de errores con DLQ, consistencia eventual sin orden global, y `correlationId` propagado sin regenerarse |

Ningún principio queda en estado no conforme. La única tensión —MinIO— se justifica abajo en
vez de esconderse.

## Project Structure

### Documentation (this feature)

```text
specs/005-event-contracts-saga/
├── plan.md                              # Este archivo
├── spec.md                              # Qué y por qué
├── research.md                          # Fase 0: R1–R12
├── data-model.md                        # Fase 1: entidades de transporte
├── quickstart.md                        # Fase 1: cómo verificar
├── contracts/
│   ├── envelope-contract.md             # El sobre, campo por campo
│   ├── message-contract-template.md     # La forma de cada entrada del catálogo
│   └── topology-contract.md             # Exchanges, colas, claves, reintentos
├── checklists/
│   └── requirements.md                  # Calidad del spec: 16/16
└── tasks.md                             # Fase 2 — lo crea /speckit-tasks
```

### Source Code (repository root)

```text
apps/packages/contracts/
├── package.json                         # + zod; + zod-to-json-schema (dev)
├── src/
│   ├── envelope.ts                      # EDITADO: + messageVersion, producer, identity
│   ├── index.ts                         # EDITADO: exporta el catálogo
│   ├── dto/money.dto.ts                 # EDITADO: fuera AmountQuotedDto y su marca Blocked
│   ├── events/
│   │   ├── README.md                    # EDITADO: fuera la marca Blocked
│   │   ├── index.ts                     # La unión discriminada por messageType
│   │   ├── customer/                    # 15 contratos
│   │   ├── account/                     # 15 contratos
│   │   ├── transaction/                 # 7 contratos
│   │   ├── payment/                     # 3 contratos
│   │   └── audit/                       # 2 contratos
│   ├── routing/
│   │   ├── routing-keys.ts              # messageType -> routing key (identidad)
│   │   └── topology.ts                  # Descriptor de exchanges y colas
│   └── validation/
│       └── validate-message.ts          # Sobre + payload, antes del dominio
├── scripts/
│   └── emit-json-schema.ts              # Artefacto legible sin TypeScript
└── test/                                # Un caso válido y uno inválido por contrato

apps/packages/messaging/
└── src/
    ├── broker.ts                        # EDITADO: 4 exchanges, sin nombres de negocio
    ├── retry-policy.ts                  # NUEVO: 1s/5s/30s, máximo 3
    ├── dead-letter.ts                    # NUEVO: cabeceras de la DLQ
    └── request-reply.ts                 # NUEVO: cola exclusiva, correlación, 5 s

docs/events/
├── README.md                            # EDITADO: fuera la marca Blocked
├── catalog.md                           # NUEVO: los 42, con la plantilla de contracts/
├── envelope.md                          # NUEVO: serialización y versionado
├── topology.md                          # NUEVO: exchanges, colas, claves, DLQ
├── saga-transfer.md                     # NUEVO: 7 pasos, 2 finales, 6 escenarios
└── examples/                            # NUEVO: feliz, rechazo, compensación

docs/                                     # Otros documentos editados
├── domain/message-catalog.md            # Nota de ampliación: `reply` y los 7 añadidos
├── operations/README.md                 # Fuera la parte de política por consumidor
├── TECH_DEBT.md                         # TD-013 cerrada; TD-014 sigue abierta
└── architecture/adr/ADR-012-*.md        # NUEVO: almacenamiento de objetos

infra/docker/README.md                   # EDITADO: cuatro exchanges, no uno (R4)
```

**Structure Decision**: el grueso del trabajo cae en los **dos paquetes compartidos** y en
`docs/`. Las capas `domain` y `application` de las siete aplicaciones siguen vacías y
bloqueadas hasta T-15.

> **Corregido durante la implementación.** Este plan afirmaba que `git diff -- apps/gateway
> apps/services apps/web` saldría vacío. Es falso, y lo era desde el principio: el sobre gana
> `producer` e `identity` y el adaptador pasa de un exchange a cuatro, y esas firmas las
> consumen el Gateway (`request-envelope.ts`, `broker.provider.ts`) y las pruebas de los cinco
> servicios. Lo que sí se sostiene, y es lo que hay que verificar, es que el cambio en `apps/`
> se limita a **adaptar consumidores existentes a las firmas nuevas**: cero lógica de negocio,
> cero archivos nuevos en `domain` o `application`.

## Complexity Tracking

| Violación | Por qué se necesita | Alternativa simple, y por qué se rechazó |
|-----------|---------------------|------------------------------------------|
| **Un componente de infraestructura que el enunciado no pide** (MinIO), rozando el principio II | Los bytes de la foto del documento —hasta 5 MB, ~6,7 MB en base64— son dos órdenes de magnitud mayores que cualquier otro mensaje. Por el broker obligan a subir el límite de frame, y un objeto así atascado en una DLQ ocupa memoria del broker durante toda la demostración. Sacarlos mantiene todo payload bajo 64 KB | **Bytes dentro del comando, en base64**: cero infraestructura nueva y estrictamente conforme. Rechazada por el equipo el 2026-08-19 por el coste operativo descrito. La frontera que lo mantiene conforme al principio II está escrita y es verificable: MinIO no guarda estado de negocio, nadie lo consulta para decidir, y el objeto se borra tras su retención. Si alguien empieza a consultarlo para decidir algo, esta justificación caduca |

## Notas de ejecución

**El script de contexto de agente no existe.** El paso "update agent context by running the
agent script" no se ejecutó porque `.specify/scripts/bash/` contiene sólo
`check-prerequisites.sh`, `common.sh`, `create-new-feature.sh`, `setup-plan.sh`,
`setup-tasks.sh` y el `create-feature-branch.sh` local. No hay `update-agent-context.sh` que
invocar. `AGENTS.md` y `CLAUDE.md` se mantienen a mano, como hasta ahora.

**Orden que las tareas tendrán que respetar**, porque hay dependencias reales:

1. La comprobación OSV de `zod` **antes** de escribir un solo contrato. Si falla, R1 cambia y
   con él la forma de los 42 archivos.
2. El sobre **antes** que los contratos: todos lo envuelven.
3. Los contratos **antes** que la topología: las routing keys son los `messageType`.
4. El ADR de MinIO **antes** que el contrato de la foto, para no escribir un contrato que
   depende de una decisión sin registrar.
5. La corrección de `infra/docker/README.md` **en este ticket**, no en T-06: dejarla fijaría
   una topología de un solo exchange en el ticket que la implementa.
