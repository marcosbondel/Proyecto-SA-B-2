# Documento técnico — Bank USAC

Este documento es el **punto de entrada a la documentación del proyecto**. Su
trabajo no es repetir lo que ya está escrito en otra parte, sino decir, para
cada entregable que exige el enunciado (§4.4), **cuál es el archivo real del
repositorio que lo cumple** y en qué estado está.

Todo lo que se enlaza aquí está versionado en este repositorio y en formato
Markdown, como pide el enunciado. Los diagramas se entregan además como fuentes
de texto versionadas (`.mmd` y `.puml`) y como imagen exportada.

> **Sobre el idioma.** Los documentos dirigidos a personas usuarias y a la
> evaluación están en español: el manual de usuario y todos los diagramas. La
> documentación interna de ingeniería está en inglés, que es el idioma del
> código. Los enlaces de este documento indican cuál es cuál cuando importa.

---

## 1. Los entregables del enunciado y dónde están

| Entregable (§4.4) | Dónde vive | Estado |
| --- | --- | --- |
| **Documento técnico completo del sistema** | Este documento, más [`docs/architecture.md`](architecture.md) (arquitectura integral en español), [`ARCHITECTURE.md`](../ARCHITECTURE.md) (especificación técnica en inglés) y [`README.md`](../README.md) (puesta en marcha y verificación) | Completo |
| **Diagramas arquitectónicos** | [`docs/architecture/diagrams/`](architecture/diagrams/) — ocho diagramas, cada uno con sus dos fuentes de texto y su exportación. Ver [§3](#3-diagramas-arquitectónicos) | Completo |
| **Definición de SLI, SLO y SLA** | [`docs/RELIABILITY.md`](RELIABILITY.md) — ver [§4](#4-sli-slo-y-sla) | Completo |
| **Casos de uso detallados** | [`docs/domain/use-cases.md`](domain/use-cases.md) (los seis flujos, en prosa) y [`docs/architecture/diagrams/cdu/`](architecture/diagrams/cdu/README.md) (la jerarquía de diagramas UML). Ver [§5](#5-casos-de-uso) | Completo |
| **Justificación de decisiones arquitectónicas** | [`docs/adr.md`](adr.md) (registro unificado en español) y [`docs/architecture/adr/`](architecture/adr/README.md) (trece ADRs detallados más la [matriz de decisiones](architecture/decision-matrix.md)). Ver [§6](#6-justificación-de-las-decisiones-arquitectónicas) | Completo |
| **En formato markdown** | Todo el árbol `docs/`. El inventario y la propiedad de cada documento están en [`docs/DOC_INVENTORY.md`](DOC_INVENTORY.md) | Completo |
| **Manual de usuario** | [`docs/manual/README.md`](manual/README.md), con una guía por rol. Ver [§7](#7-manual-de-usuario) | Completo |
| **Repositorio con estrategia de monorepo** | Un solo repositorio, un `pnpm-workspace.yaml`, un lockfile y Turborepo como task runner. Ver [§8](#8-código-fuente-y-monorepo) | Completo |
| **Código fuente separado por microservicio** | [`apps/services/`](../apps/services/) — cinco servicios, uno por carpeta, más `apps/gateway` y `apps/web`. Ver [§8](#8-código-fuente-y-monorepo) | Completo |
| **Archivos de configuración para despliegue en Kubernetes** | [`infra/k8s/`](../infra/k8s/README.md) — chart de Helm en `infra/k8s/helm/bank-usac`, el clúster kind en `infra/k8s/kind` y el procedimiento completo en [`docs/operations/DEPLOYMENT.md`](operations/DEPLOYMENT.md). Ver [§9](#9-contenedores-y-despliegue) | Completo |
| **Documento de Decisión y Diseño de Arquitectura (DDA)** | [`docs/dda.md`](dda.md) — análisis de caso de negocio, CDU, especificaciones, atributos de calidad y matrices de trazabilidad | Completo |
| **Guía Integral de Pruebas y Happy Path** | [`docs/happypath.md`](happypath.md) — recorrido visual exhaustivo de los 3 actores con 60+ capturas | Completo |
| **Frontend** | [`apps/web/`](../apps/web/README.md), con su guía de diseño en [`docs/DESIGN.md`](DESIGN.md). Ver [§10](#10-frontend) | Completo |

---

## 2. El sistema, en una página

Bank USAC es un sistema bancario distribuido en **cinco microservicios**, con un
**API Gateway** como único punto de entrada y **RabbitMQ** como único medio de
comunicación entre servicios.

| Componente | Responsabilidad | Base de datos |
| --- | --- | --- |
| **API Gateway** | Único punto de entrada. Autentica con JWT, autoriza por rol y traduce cada petición HTTP en un mensaje. No tiene lógica de negocio. | Ninguna |
| **Customer Service** | Clientes, credenciales, activación por correo, validación de identidad. | Propia |
| **Account Service** | Cuentas, saldos y movimientos. Es el único que decide si hay fondos. | Propia |
| **Transaction Service** | La máquina de estados de la transferencia y la coordinación de la Saga. **Nunca lee un saldo.** | Propia |
| **Payment Service** | El paso de pago y su escalera de reintentos. **No ordena nada a nadie.** | Propia |
| **Notification & Audit Service** | El rastro de auditoría y las notificaciones. Escucha todos los eventos. | Propia |
| **Frontend** | La interfaz web. Habla solo con el Gateway. | Ninguna |

Tres reglas gobiernan el diseño y están comprobadas por pruebas que rompen la
compilación si se violan:

1. **Ningún servicio llama a otro.** No hay una sola llamada HTTP entre
   servicios; todo va por el broker.
2. **Ningún servicio lee la base de datos de otro.** Cada uno tiene la suya y es
   el único que la toca.
3. **El Gateway no orquesta.** Publica y responde; la Saga la coordina
   Transaction Service por coreografía.

La consecuencia visible para quien usa el sistema es que **una petición se
acepta antes de completarse**: el Gateway responde `202` y el resultado real se
consulta después por su identificador de correlación. El manual de usuario
explica qué significa eso en pantalla.

La descripción completa —capas, reglas de dependencia, stack y estado actual—
está en [`ARCHITECTURE.md`](../ARCHITECTURE.md). El modelo de dominio, con qué
dato posee cada servicio y qué invariantes protege, está en
[`docs/domain/`](domain/README.md).

---

## 3. Diagramas arquitectónicos

Los ocho diagramas que exige el enunciado están en
[`docs/architecture/diagrams/`](architecture/diagrams/). Cada uno se entrega con
**dos fuentes de texto versionadas que deben coincidir** —Mermaid (`.mmd`) y
PlantUML (`.puml`)— más su exportación en PNG. Si las dos fuentes no coinciden,
el diagrama no está hecho: es la regla que fija la
[ADR-013](architecture/adr/ADR-013-diagramming-toolchain-revision.md).

| # | Diagrama | Fuentes |
| --- | --- | --- |
| 1 | Arquitectura general | [`.mmd`](architecture/diagrams/01-arquitectura-general.mmd) · [`.puml`](architecture/diagrams/01-arquitectura-general.puml) · [`.png`](architecture/diagrams/01-arquitectura-general.png) |
| 2 | C4 Nivel 1 — Contexto | [`.mmd`](architecture/diagrams/02-c4-contexto.mmd) · [`.puml`](architecture/diagrams/02-c4-contexto.puml) · [`.png`](architecture/diagrams/02-c4-contexto.png) |
| 3 | C4 Nivel 2 — Contenedores | [`.mmd`](architecture/diagrams/03-c4-contenedores.mmd) · [`.puml`](architecture/diagrams/03-c4-contenedores.puml) · [`.png`](architecture/diagrams/03-c4-contenedores.png) |
| 4 | C4 Nivel 3 — Componentes | [`.mmd`](architecture/diagrams/04-c4-componentes.mmd) · [`.puml`](architecture/diagrams/04-c4-componentes.puml) · [`.png`](architecture/diagrams/04-c4-componentes.png) · [`.dsl`](architecture/diagrams/04-c4-componentes.dsl) |
| 5 | UML — Despliegue | [`.mmd`](architecture/diagrams/05-uml-despliegue.mmd) · [`.puml`](architecture/diagrams/05-uml-despliegue.puml) · [`.png`](architecture/diagrams/05-uml-despliegue.png) |
| 6 | UML — Secuencia: crear cuenta | [`.mmd`](architecture/diagrams/06-uml-secuencia-crear-cuenta.mmd) · [`.puml`](architecture/diagrams/06-uml-secuencia-crear-cuenta.puml) · [`.png`](architecture/diagrams/06-uml-secuencia-crear-cuenta.png) |
| 7 | UML — Secuencia: transferencia con Saga | [`.mmd`](architecture/diagrams/07-uml-secuencia-transferencia.mmd) · [`.puml`](architecture/diagrams/07-uml-secuencia-transferencia.puml) · [`.png`](architecture/diagrams/07-uml-secuencia-transferencia.png) |
| 8 | UML — Casos de uso (jerarquía) | [`cdu/`](architecture/diagrams/cdu/README.md) — un diagrama de alto nivel, la primera descomposición y una carpeta por microservicio |

### Cómo se leen

- **El Gateway como punto de entrada.** El diagrama de contexto (2) dibuja el
  API Gateway explícitamente dentro del límite del sistema y hace que **las tres
  personas usuarias lleguen solo a él**. Nada externo habla con el núcleo
  bancario.
- **El tipo de interacción está etiquetado.** Cada relación de los diagramas de
  contexto y de secuencia declara tecnología, protocolo y si la interacción es
  síncrona o asíncrona: `HTTPS/REST · síncrono` del navegador al Gateway,
  `AMQP 0-9-1 · comando`, `· evento` o `· request/reply` del Gateway hacia
  adentro.
- **El despliegue (5)** muestra qué corre dentro del clúster —los siete
  componentes, como Deployments y Services en el namespace `bank-usac`— y qué
  corre fuera: las cinco bases PostgreSQL, RabbitMQ y MinIO. Esa separación no
  es casual; es el principio III de la constitución del proyecto.
- **Los casos de uso (8)** son una jerarquía, no un solo diagrama: el objetivo
  general, la descomposición por microservicio y, dentro de cada uno, sus
  funcionalidades y sus diagramas de actividad.

### Cómo se regeneran

```bash
plantuml -charset UTF-8 -tpng docs/architecture/diagrams/<archivo>.puml
npx -y -p @mermaid-js/mermaid-cli mmdc -i <archivo>.mmd -o <salida>.png -b white
```

La opción `-charset UTF-8` no es opcional: sin ella se rompen las tildes.

---

## 4. SLI, SLO y SLA

Están definidos en [`docs/RELIABILITY.md`](RELIABILITY.md), y se definieron en
T-03 **antes de implementar**, porque el enunciado coloca las métricas SRE en el
paso 7 de su metodología, antes del paso 8.

| Sección | Qué contiene |
| --- | --- |
| [Service Level Indicators](RELIABILITY.md#service-level-indicators) | Qué se mide y cómo. |
| [Service Level Objectives](RELIABILITY.md#service-level-objectives) | El objetivo numérico de cada indicador. |
| [Service Level Agreement](RELIABILITY.md#service-level-agreement) | El compromiso hacia quien usa el sistema. |
| [What This Obliges Every Service To Build](RELIABILITY.md#what-this-obliges-every-service-to-build) | Qué tiene que construir cada servicio para que esos números sean medibles. |

El mismo documento recoge las preocupaciones de diseño que el enunciado exige
tratar en cada servicio: idempotencia, reintentos acotados, manejo explícito de
errores de negocio y de infraestructura, consistencia eventual y trazabilidad
por `correlationId`.

---

## 5. Casos de uso

Se entregan en dos formas, deliberadamente:

**En prosa** — [`docs/domain/use-cases.md`](domain/use-cases.md). Seis flujos,
cada uno con su actor, su entrada, su resultado observable, la secuencia de
servicios que reaccionan y **los fallos que son esperados en lugar de
accidentales**:

| # | Caso de uso | Exigido por nombre en el enunciado |
| --- | --- | --- |
| 1 | [Registrar un cliente](domain/use-cases.md#1-register-a-customer) | |
| 2 | [Abrir una cuenta](domain/use-cases.md#2-open-an-account) | Sí |
| 3 | [Consultar un saldo](domain/use-cases.md#3-query-a-balance) | Sí |
| 4 | [Activar por correo](domain/use-cases.md#4-activate-by-email) | |
| 5 | [Iniciar sesión](domain/use-cases.md#5-sign-in) | |
| 6 | [Transferir dinero](domain/use-cases.md#6-transfer-money) | Sí |

**En diagramas UML** —
[`docs/architecture/diagrams/cdu/`](architecture/diagrams/cdu/README.md). Una
jerarquía de tres niveles: el objetivo general (`CDU000`), la primera
descomposición en los cinco microservicios (`CDU001`–`CDU005`) y, dentro de cada
carpeta de servicio, sus funcionalidades numeradas y sus diagramas de actividad
en `flujos/`.

Los mensajes que se citan en ambos vienen del
[catálogo de mensajes](domain/message-catalog.md), y el flujo completo de la
Saga está desarrollado en [`docs/events/saga-transfer.md`](events/saga-transfer.md).

---

## 6. Justificación de las decisiones arquitectónicas

Trece registros de decisión en
[`docs/architecture/adr/`](architecture/adr/README.md). Cada uno dice qué se
decidió, **qué alternativas se rechazaron y por qué**, y qué compromiso se
aceptó a cambio.

| ADR | Decisión |
| --- | --- |
| [ADR-001](architecture/adr/ADR-001-backend-stack.md) | Stack de backend |
| [ADR-002](architecture/adr/ADR-002-frontend-stack.md) | Stack de frontend |
| [ADR-003](architecture/adr/ADR-003-communication-model.md) | Modelo de comunicación entre servicios |
| [ADR-004](architecture/adr/ADR-004-message-broker.md) | Broker de mensajería |
| [ADR-005](architecture/adr/ADR-005-persistence.md) | Persistencia |
| [ADR-006](architecture/adr/ADR-006-containerization.md) | Contenerización |
| [ADR-007](architecture/adr/ADR-007-local-orchestration.md) | Orquestación local |
| [ADR-008](architecture/adr/ADR-008-service-internal-architecture.md) | Arquitectura interna de cada servicio |
| [ADR-009](architecture/adr/ADR-009-distributed-transactions.md) | Transacciones distribuidas (Saga y compensación) |
| [ADR-010](architecture/adr/ADR-010-authentication.md) | Autenticación |
| [ADR-011](architecture/adr/ADR-011-diagramming-toolchain.md) | Herramientas de diagramación |
| [ADR-012](architecture/adr/ADR-012-object-storage.md) | Almacenamiento de objetos |
| [ADR-013](architecture/adr/ADR-013-diagramming-toolchain-revision.md) | Revisión de la diagramación — **sustituye a la ADR-011** |

La [matriz de decisiones](architecture/decision-matrix.md) las consolida en una
sola tabla —decisión, alternativas rechazadas, compromiso aceptado,
consecuencia— e indica qué penalización del enunciado evita cada una.

Una ADR es una restricción de diseño, no una nota: cambiar una decisión exige
una ADR nueva que sustituya a la anterior, no editar la vieja.

---

## 7. Manual de usuario

[`docs/manual/README.md`](manual/README.md), en español y en lenguaje de persona
usuaria.

| Documento | Para quién |
| --- | --- |
| [Manual de usuario](manual/README.md) | Todos. Acceso al sistema, cómo leer las respuestas asíncronas, y los cinco módulos. |
| [Manual del Cliente](manual/rol-cliente.md) | El cuentahabiente. |
| [Manual del Cajero Receptor](manual/rol-cajero-receptor.md) | Personal de ventanilla. |
| [Manual del Administrador](manual/rol-administrador.md) | Supervisión, gestión de cuentas y auditoría. |

El manual incluye una sección explícita de **lo que el sistema todavía no puede
hacer**, para que nadie confunda una funcionalidad pendiente con una avería. El
detalle técnico de cada una está en [`docs/TECH_DEBT.md`](TECH_DEBT.md).

---

## 8. Código fuente y monorepo

Un solo repositorio, con `pnpm-workspace.yaml`, un único lockfile y **Turborepo**
como ejecutor de tareas. Todo el código vive bajo `apps/`:

| Ruta | Qué es |
| --- | --- |
| [`apps/gateway/`](../apps/gateway/) | API Gateway |
| [`apps/web/`](../apps/web/README.md) | Frontend (Nuxt) |
| [`apps/services/customer-service/`](../apps/services/customer-service/) | Customer Service |
| [`apps/services/account-service/`](../apps/services/account-service/) | Account Service |
| [`apps/services/transaction-service/`](../apps/services/transaction-service/) | Transaction Service |
| [`apps/services/payment-service/`](../apps/services/payment-service/) | Payment Service |
| [`apps/services/notification-audit-service/`](../apps/services/notification-audit-service/) | Notification & Audit Service |
| [`apps/packages/contracts/`](../apps/packages/) | Contratos de mensajes compartidos |
| [`apps/packages/messaging/`](../apps/packages/) | Cliente del broker |
| [`apps/packages/tooling/`](../apps/packages/) | Configuración compartida de lint y build |

**La separación por microservicio no es solo de carpetas: está comprobada.**
`pnpm lint` falla si un servicio importa código de otro, si la capa de dominio
importa un framework, o si la capa de aplicación importa infraestructura. Además,
cada servicio tiene un `test/isolation.spec.ts` que rompe la compilación si el
servicio consulta la tabla de otro o hace una llamada HTTP.

Los comandos para compilar, probar y levantar el sistema están en el
[README](../README.md#commands) y en [`ARCHITECTURE.md`](../ARCHITECTURE.md#commands).

---

## 9. Contenedores y despliegue

**Contenedores.** Siete imágenes multi-etapa, un Dockerfile por componente y
ninguno genérico, todas corriendo como usuario sin privilegios y sin ninguna
credencial dentro de la imagen. El inventario completo —una fila por componente,
con su puerto, su comando de arranque, sus health checks y las variables que
necesita en tiempo de ejecución— está en
[`docs/operations/CONTAINERS.md`](operations/CONTAINERS.md).

Los tres comandos que lo demuestran:

```bash
pnpm images:build   # las siete imágenes, etiquetadas con el commit que llevan dentro
pnpm images:smoke   # etiquetas, puerto, usuario, ausencia de secretos, casos degradados
pnpm images:flow    # registrar, abrir cuentas, transferir — a través de las imágenes
```

`pnpm images:flow` ejecuta las **tres formas de la Saga** contra las imágenes
construidas y comprueba los saldos antes y después de cada una: una
transferencia que se completa, un pago rechazado que compensa al primer intento,
y uno que sube la escalera de reintentos hasta agotarla y luego compensa. La
compensación se afirma como un hecho sobre el dinero, no como un estado que
alguien escribió.

**Kubernetes.** Los artefactos de despliegue están en
[`infra/k8s/`](../infra/k8s/README.md):

| Ruta | Qué es |
| --- | --- |
| `infra/k8s/helm/bank-usac/` | El chart de Helm: `Chart.yaml`, `values.yaml` y una plantilla de Deployment y Service por componente. |
| `infra/k8s/helm/bank-usac/templates/external/` | Los Services sin selector que apuntan a las dependencias que corren **fuera** del clúster: las cinco bases PostgreSQL, RabbitMQ y MinIO. |
| `infra/k8s/kind/` | La configuración del clúster local kind. |

Las bases de datos, el broker y el almacén de objetos corren fuera del clúster a
propósito: es el principio III de la constitución del proyecto, y es lo que
dibuja el [diagrama de despliegue](architecture/diagrams/05-uml-despliegue.puml).

El chart **se instala en un clúster kind real** (v0.33.0), y no solo pasa
`helm lint` y `helm template`: los siete pods llegan a `1/1 Ready` contra el
PostgreSQL, el RabbitMQ y el MinIO de fuera del clúster, y el Gateway responde
por `port-forward`. La primera instalación encontró dos defectos que un chequeo
de renderizado no podía ver —un arreglo asociativo de bash 4 que rompía en el
bash 3.2 de macOS, y unos valores por defecto de usuario y base de datos que
apuntaban cada pod al rol equivocado—, que es exactamente la razón por la que
`helm template` no basta.

El procedimiento completo —prerrequisitos con versiones, los cuatro comandos,
la verificación, el escalado y cada modo de fallo— está en
[`docs/operations/DEPLOYMENT.md`](operations/DEPLOYMENT.md).

**La evidencia de la ejecución está capturada**, y por un guion en vez de un
pegado, de modo que se puede volver a producir en cualquier momento:

```bash
pnpm k8s:evidence   # solo lee: helm list, get pods/svc/nodes, docker ps, /ready ×7
```

Escribe en [`specs/008-audit-remediation/evidence/`](../specs/008-audit-remediation/evidence/)
la salida real de cada comando, incluida la respuesta `/ready` de los siete
componentes y el `docker ps` que demuestra el requisito del enunciado §4.2: las
cinco bases, el broker y el almacén de objetos corriendo **fuera** del clúster.

---

## 10. Frontend

[`apps/web/`](../apps/web/README.md) — Nuxt, con la navegación filtrada por rol,
la sesión, cuatro componentes compartidos y cinco módulos de funcionalidad:
Clientes, Cuentas, Transferencias, Pagos y Auditoría.

La guía de interfaz —tipografía, color, jerarquía, textos y el reglamento de qué
puede decir una pantalla sobre una operación asíncrona— está en
[`docs/DESIGN.md`](DESIGN.md), y **debe leerse antes de crear o modificar
cualquier pantalla, componente o texto de interfaz**.

Una decisión de producto atraviesa toda la interfaz y conviene señalarla: **una
pantalla nunca dice «hecho» cuando el sistema solo dijo «recibido»**. Un `202`
se muestra como *solicitud aceptada*, y un tiempo de espera agotado se muestra
como *no pudimos confirmar*, nunca como un fallo. El manual de usuario le
explica esa distinción a quien usa el sistema.

---

## 11. Qué no está terminado

Este documento no afirma que el sistema esté completo, porque no lo está. Lo que
falta está registrado, con su decisión y su ticket, en
[`docs/TECH_DEBT.md`](TECH_DEBT.md); lo que un usuario notaría está resumido en
el [manual](manual/README.md#9-lo-que-el-sistema-todavía-no-puede-hacer).

Los huecos que más se notan:

- **El dinero entra por ventanilla, pero no sale.** `POST /api/accounts/:accountId/deposit`
  registra un depósito y la pantalla `/cuentas/deposito` lo usa; es la única ruta
  de dinero que responde `200` en lugar de `202`, porque un depósito es un solo
  abono sin contraparte y no hay Saga que esperar. **La operación simétrica no
  existe**: nadie puede retirar efectivo, así que el saldo de una cuenta solo
  baja transfiriendo. Es la mitad todavía abierta de la deuda TD-018.
- **No hay listado ni búsqueda de clientes.** `GET /api/customers/:customerId`
  lee una ficha —y por eso el formulario de actualización se rellena con datos
  reales y la pantalla muestra el estado de identidad verdadero—, pero ninguna
  ruta devuelve *varios* clientes. `/clientes` es por eso un conjunto de puertas
  en lugar de una tabla: para abrir una ficha hay que conocer su UUID. La única
  lista de personas que existe es la cola de validación pendiente, que responde
  a otra pregunta.
- **La foto del documento no puede mostrarse al cajero.** La validación de
  identidad sí se ejecuta de principio a fin:
  `GET /api/customers/pending-validation` arma la cola del cajero y
  `POST /api/customers/:customerId/identity-verdict` publica su veredicto
  manual. Lo que falta es la imagen. El Gateway la deposita en el almacenamiento
  de objetos durante el registro y por el broker viaja solo su referencia
  ([ADR-012](architecture/adr/ADR-012-object-storage.md)); ninguna ruta la lee de
  vuelta, así que `/clientes/validaciones/[id]` contrasta los datos declarados
  contra un recuadro vacío que explica por qué está vacío.
- **Solo un administrador puede confirmar el desenlace** de un registro o de una
  apertura de cuenta, porque `GET /api/audit` —la vía por la que la interfaz
  averigua cómo terminó cualquier comando asíncrono— está restringida a ese rol
  por la decisión D-06. La deuda TD-021 explica por qué relajar esa restricción
  sería una posición peor que mantenerla.
- **No hay forma de crear el primer administrador desde la aplicación**: el
  registro público solo acepta el rol `CLIENTE`, y pedir cualquier otro exige
  presentar una sesión de administrador que todavía no existe.

---

## Ver también

| Documento | Qué responde |
| --- | --- |
| [`README.md`](../README.md) | Cómo levantar, verificar y detener el sistema. |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | La arquitectura vigente: capas, reglas de dependencia y estado. |
| [`AGENTS.md`](../AGENTS.md) | El índice completo de la documentación y las convenciones de trabajo. |
| [`docs/domain/`](domain/README.md) | El modelo de dominio: qué posee cada servicio y qué invariantes protege. |
| [`docs/events/`](events/README.md) | El sobre de los mensajes, el catálogo de eventos, la topología del broker y la Saga. |
| [`docs/SECURITY.md`](SECURITY.md) | Clases de datos y fronteras de seguridad. |
| [`docs/METHODOLOGY.md`](METHODOLOGY.md) | Hitos, transiciones de estado y evidencia. |
| [`docs/DOC_INVENTORY.md`](DOC_INVENTORY.md) | Clasificación y propiedad de cada documento. |
