# Registro de Decisiones de Arquitectura (ADR) — Bank USAC

Este documento consolida las decisiones de arquitectura de software y diseño de sistemas adoptadas en **Bank USAC**, sintetizando el problema, las alternativas analizadas, la solución adoptada y sus trade-offs.

---

## Matriz Resumen de Decisiones (ADR-001 a ADR-014)

| Código | Título | Solución Adoptada | Alternativa Descartada | Justificación Clave |
|---|---|---|---|---|
| **ADR-001** | Ecosistema Backend | **Node.js 24 + TypeScript + NestJS** | Java Spring Boot / Go | Compartición de paquetes de tipos `@bank/contracts` y velocidad de entrega. |
| **ADR-002** | Framework Frontend | **Nuxt 4 / Vue 3 + Tailwind CSS** | React / Next.js / Angular | Paridad 1:1 con prototipo Claude Design y SSR nativo. |
| **ADR-003** | Modelo de Comunicación | **Asíncrono por Eventos (AMQP) + Request/Reply en Gateway** | HTTP síncrono inter-servicios / gRPC | Desacoplamiento temporal; resiliencia ante caídas temporales de servicios. |
| **ADR-004** | Message Broker | **RabbitMQ 4.x (AMQP 0-9-1)** | Apache Kafka / Redis Streams | Exchanges Direct/Topic, soporte de Dead-Letter Queues (DLQ) nativo. |
| **ADR-005** | Persistencia y Aislamiento | **PostgreSQL 18 (Database per Service) + `NUMERIC(14,2)`** | Base de Datos Compartida | Cumplimiento estricto de límites de dominio y precisión contable sin redondeos. |
| **ADR-006** | Contenerización | **Docker Multi-Stage con usuario `node` (UID 1000)** | Imágenes monoproceso / root | Seguridad en runtime sin privilegios root e imágenes ligeras optimizadas. |
| **ADR-007** | Orquestación | **Docker Compose (Dev) + Kubernetes / Helm (Prod)** | Docker Swarm / Minikube | Despliegues declarativos con Helm chart y reproducibilidad local idéntica. |
| **ADR-008** | Arquitectura Interna | **Clean Architecture / Hexagonal** | Capas acopladas tradicionales | Independencia del framework y lógica de negocio testeable de forma aislada. |
| **ADR-009** | Transacciones Distribuidas | **Saga Coreografiada con Compensación Contable** | Two-Phase Commit (2PC) / Saga Orquestada | Ausencia de bloqueos globales distribuidos y consistencia eventual garantizada. |
| **ADR-010** | Autenticación y RBAC | **JWT Bearer + Hasheo `scrypt` + Gateway `RolesGuard`** | Sesiones Stateful con Redis / OAuth2 | Autenticación stateless perimetral y matriz de permisos por rol (D-06). |
| **ADR-011** | Toolchain de Diagramación | **PlantUML (`.puml`) + DBML (`.dbml`) + PNG** | Herramientas propietarias binarias | Control de versiones, revisión de cambios en Git y renderizado en PRs. |
| **ADR-012** | Almacenamiento de Objetos | **MinIO (S3-Compatible) + Hash SHA-256 en BD** | Guardar archivos en PostgreSQL | No saturar el broker con binarios pesados y verificación criptográfica de DPI. |
| **ADR-013** | Paridad de Fuentes | **PlantUML para UML formal y DBML para esquemas ER** | Solo un formato | Formalismo UML estándar y modelado declarativo de base de datos. |
| **ADR-014** | Transactional Outbox | **Tabla `outbox_messages` + Scheduler Relay** | Publicación directa tras commit | Elimina la ventana de inconsistencia entre commit de base de datos y fallo de red en broker. |

---

## Decisiones de Dominio Clave (D-01 a D-06)

* **D-01 (Usuarios y Personal)**: Modelo unificado en la tabla `customers` con columna `role` (`CLIENTE`, `CAJERO_RECEPTOR`, `ADMINISTRADOR`).
* **D-02 (Cuentas)**: Clasificación de cuentas monetarias y de ahorro en Phase 1 con reglas de inactividad compartidas.
* **D-03 (Activación)**: Verificación de correo mediante token hasheado con SHA-256 de un solo uso.
* **D-04 (Seguridad de Login)**: Errores homogéneos de autenticación (`INVALID_CREDENTIALS`) para prevenir enumeración de usuarios.
* **D-05 (Identificador de Acceso)**: El correo electrónico es el identificador principal para inicio de sesión.
* **D-06 (Matriz de Control de Acceso)**: Reglas estrictas de autorización donde el personal del banco es el único facultado para validar DPIs, abrir cuentas de terceros y recibir depósitos en efectivo.
