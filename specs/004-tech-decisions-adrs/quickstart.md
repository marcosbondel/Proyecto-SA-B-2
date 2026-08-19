# Quickstart: verificación de T-03

Cómo comprobar que el registro está terminado. Una comprobación por criterio de éxito,
separando lo **mecánico** (lo ejecuta cualquiera) de lo que **exige juicio humano** (nadie lo
puede automatizar sin volver a decidir).

Todo se ejecuta desde la raíz del repositorio.

## Prerrequisitos

```bash
node --version   # 24.19.0 (.nvmrc)
pnpm --version   # 11.21.0
```

No hace falta levantar nada: el entregable es documentación.

---

## 0. La prueba de que no se tocó código

```bash
git diff --stat -- apps/          # debe salir vacío  (D-1)
pnpm install && pnpm build
pnpm lint && pnpm test            # deben pasar igual que en main  (D-2)
```

`pnpm build` debe preceder a `pnpm test` en un clon limpio: los paquetes compartidos se
consumen desde `dist/`.

Si `pnpm lint` falla, algo se tocó bajo `apps/` que no debía tocarse. **No se añade una
excepción para que pase** — se revierte el cambio.

---

## 1. SC-001 — las once decisiones tienen ADR

```bash
ls docs/architecture/adr/ADR-*.md | wc -l          # 11
grep -c '^| ADR-0' docs/architecture/decision-matrix.md   # 11
```

**Mecánico.** Además, cotejar los once títulos contra la lista de FR-001: stack backend,
frontend, broker, persistencia, contenedores, cluster local, arquitectura interna,
diagramación, comunicación, saga y autenticación. Once archivos con un nombre que no cubra las
once decisiones pasaría el conteo y fallaría el criterio.

## 2. SC-002 — toda alternativa descartada tiene razón técnica

```bash
# Estructura presente en los once
grep -L 'Alternatives considered' docs/architecture/adr/ADR-*.md   # sin salida
grep -L 'Rejected because'        docs/architecture/adr/ADR-*.md   # sin salida

# Las listas cerradas del enunciado, citadas donde corresponde
grep -c -E 'Java|TypeScript|Go'                     docs/architecture/adr/ADR-001-*.md
grep -c -E 'Spring Boot 4|NestJS'                   docs/architecture/adr/ADR-001-*.md
grep -c -E 'Kafka|RabbitMQ|NATS|gRPC'               docs/architecture/adr/ADR-004-*.md
```

**Exige juicio humano**: que cada `Rejected because` invoque uno de los cuatro criterios de R4
—carga operativa local, soporte del patrón, restricción citada del enunciado, riesgo concreto—
y no una preferencia. Esta es la comprobación que decide los 10 puntos del criterio 1.3, y
ningún `grep` la sustituye.

Comprobar también que ADR-004 descarta las tres alternativas **una por una** (R8): un ADR que
solo argumenta contra Kafka deja NATS y gRPC async sin responder.

## 3. SC-003 — el ADR de autenticación no deja nada abierto

```bash
grep -E 'HS256|expir|1h|Gateway|claims|revocation' docs/architecture/adr/ADR-010-*.md
grep -i 'not constrained\|§4.1' docs/architecture/adr/ADR-010-*.md
```

**Lista de verificación** — las cinco respuestas y las cuatro obligaciones:

- [ ] Librería nombrada (`@nestjs/jwt`, `passport-jwt` solo en el Gateway)
- [ ] Algoritmo **HS256**, con el descarte razonado de RS256
- [ ] Expiración con **valor numérico** (1 h) y su razón; sin refresh token
- [ ] Emisión **en el Gateway**, a partir de los claims de `customer.authenticate`
- [ ] Validación **solo en el Gateway**; identidad verificada en el sobre
- [ ] Revocación declarada **fuera de alcance** (FR-005)
- [ ] Las tres consecuencias de FR-005a: campo de identidad en el sobre (define **T-05**);
      supuesto de confianza del broker; secreto como Secret de Kubernetes, nunca versionado
- [ ] Distinción explícita frente al **token de activación** de T-02 (FR-005b, R12)
- [ ] Veredicto sobre los principios **IV** y **V** de la constitución

Ninguna respuesta puede quedar en "a definir". Si una lo está, SC-003 falla.

## 4. SC-004 — SLI, SLO y SLA claros y medibles

```bash
grep -c 'SLI-' docs/RELIABILITY.md      # ≥ 6
grep -c 'SLO-' docs/RELIABILITY.md      # ≥ 5
grep -i 'Blocked' docs/RELIABILITY.md   # sin salida en la sección SLI/SLO/SLA  (D-5)
```

**Exige juicio humano**, y es el criterio con el corte más duro de la rúbrica: 5 puntos o 0,
sin rango intermedio (§8.2 p. 26).

- [ ] Los **6 SLI** tienen indicador, **fórmula** y **fuente de datos concreta**
- [ ] Los **5 SLO** tienen umbral **numérico** (≥ 99 %, ≥ 95 %, y tres del 100 %)
- [ ] El **SLA** declara su alcance académico: observable solo durante la demostración, sin
      disponibilidad productiva
- [ ] Queda escrita la instrumentación que cada servicio debe implementar desde el inicio
      (timestamps, logs con `correlationId`, conteo de retries, DLQ por cola)

Un SLI sin fuente es una definición vaga aunque tenga fórmula: nadie puede medirlo.

## 5. SC-005 — cero contradicciones

**Exige juicio humano.** Revisión cruzada de los trece documentos contra:

- [ ] `.specify/memory/constitution.md` — los ocho principios. ADR-010 contra IV y V en
      particular
- [ ] `docs/domain/` (T-02) — sobre todo que ADR-010 **no** contradiga
      `message-catalog.md` ("replies with claims, not a token") ni `use-cases.md`
- [ ] `ARCHITECTURE.md` — stack, capas y reglas de dependencia
- [ ] El enunciado, rev. 2026-08-13 — que ninguna decisión salga de las listas permitidas

```bash
# Las seis citas desplazadas que ya se corrigieron (R5): sección + página equivocada.
# La comprobación es por PAREJA sección/página, no por número de página suelto.
grep -rnE '§4\.2[^.]*(Alcance|Scope)[^0-9]*(page|p\.) ?7\b' docs/architecture/
grep -rnE '§4\.3[^0-9]*(page|p\.) ?13\b'                    docs/architecture/
grep -rnE '§6[^0-9]*(page|p\.) ?16\b'                       docs/architecture/
grep -rnE '1\.3[^0-9]*(page|p\.) ?21\b'                     docs/architecture/
grep -rnE '2\.9[^0-9]*(page|p\.) ?25\b'                     docs/architecture/
grep -rnE '§8\.3[^0-9]*(page|p\.) ?26\b'                    docs/architecture/
```

Sin salida en ninguno. Si alguna produce resultados, alguien copió una cita vieja.

> **La página 7 sí es una cita válida** y no debe buscarse a ciegas: es donde están "Reglas de
> diseño obligatorias", "Patrones esperados" (con `Saga (obligatorio)`, que **ADR-009 cita**),
> "Consideraciones SRE" y "Observaciones críticas". Lo desplazado era §4.2 *Alcance* citado
> como p. 7 cuando está en la p. 8. Un `grep 'p. 7'` a secas daría un falso positivo sobre
> ADR-009.

## 6. SC-006 — índice, enlaces y aprobación

```bash
grep -c 'ADR-0' ARCHITECTURE.md                          # ≥ 11
grep -c 'ADR-0' docs/architecture/adr/README.md          # ≥ 11
grep -i 'adr' AGENTS.md docs/design-docs/index.md        # una entrada en cada uno

# Ningún enlace roto hacia los ADRs
grep -rho 'docs/architecture/adr/[A-Za-z0-9./-]*\.md' --include='*.md' . \
  | sort -u | while read -r f; do [ -f "$f" ] || echo "ROTO: $f"; done
```

**Exige juicio humano**: que la aprobación del equipo conste (FR-009) y que los once ADRs hayan
pasado de `Proposed` a `Accepted`.

```bash
grep -c 'Status.*Accepted' docs/architecture/adr/ADR-*.md
```

---

## Trazabilidad requisito → artefacto

| Requisito | Dónde se cumple | Comprobación |
| --- | --- | --- |
| FR-001 | Los 11 ADRs | §1 |
| FR-002 | `adr-template.md` C-1, C-2 | §2 |
| FR-003 | ADR-001 | §2 |
| FR-004 | ADR-004 | §2 |
| FR-005, FR-005a, FR-005b | ADR-010 | §3 |
| FR-006 | `decision-matrix.md` | §1, §5 |
| FR-007 | `docs/RELIABILITY.md` | §4 |
| FR-008 | `ARCHITECTURE.md` | §6 |
| FR-008a | `ARCHITECTURE.md` "Current State" | §5 |
| FR-009 | `adr/README.md`, PR de `feature/T-03` | §6 |
| FR-010 | Revisión cruzada | §5 |
| FR-011 | Nota de gobernanza en `adr/README.md` | §6 |

## Lo que este quickstart no puede verificar

Que las decisiones sean **correctas**. Solo verifica que estén registradas, justificadas,
enlazadas y sin contradicciones. Que RabbitMQ sea mejor que NATS para este proyecto es un
juicio del equipo, y la evidencia de si acertó llega con la implementación y con T-24.
