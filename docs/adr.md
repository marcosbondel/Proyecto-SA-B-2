# Registro Unificado de Decisiones de Arquitectura (ADR) — Bank USAC

---

## Índice

- [Registro Unificado de Decisiones de Arquitectura (ADR) — Bank USAC](#registro-unificado-de-decisiones-de-arquitectura-adr--bank-usac)
  - [Índice](#índice)
  - [1. Introducción y Propósito](#1-introducción-y-propósito)
  - [2. Matriz Resumen de Decisiones Arquitectónicas](#2-matriz-resumen-de-decisiones-arquitectónicas)
  - [3. Decisiones de Arquitectura de Software y Ecosistema (ADR-001 a ADR-012)](#3-decisiones-de-arquitectura-de-software-y-ecosistema-adr-001-a-adr-012)
    - [ADR-001: Ecosistema y Runtime del Backend](#adr-001-ecosistema-y-runtime-del-backend)
    - [ADR-002: Ecosistema y Framework del Frontend](#adr-002-ecosistema-y-framework-del-frontend)
    - [ADR-003: Modelo de Comunicación Inter-Servicios](#adr-003-modelo-de-comunicación-inter-servicios)
    - [ADR-004: Broker de Mensajería Asíncrona](#adr-004-broker-de-mensajería-asíncrona)
    - [ADR-005: Motor de Persistencia y Estrategia de Aislamiento de Datos](#adr-005-motor-de-persistencia-y-estrategia-de-aislamiento-de-datos)
    - [ADR-006: Estrategia de Contenerización e Imágenes Base](#adr-006-estrategia-de-contenerización-e-imágenes-base)
    - [ADR-007: Estrategia de Orquestación Local y en la Nube](#adr-007-estrategia-de-orquestación-local-y-en-la-nube)
    - [ADR-008: Arquitectura Interna de los Microservicios (Clean Architecture)](#adr-008-arquitectura-interna-de-los-microservicios-clean-architecture)
    - [ADR-009: Transacciones Distribuidas y Consistencia (Saga Coreografiada)](#adr-009-transacciones-distribuidas-y-consistencia-saga-coreografiada)
    - [ADR-010: Autenticación, Sesiones y Autorización por Roles (RBAC)](#adr-010-autenticación-sesiones-y-autorización-por-roles-rbac)
    - [ADR-011: Herramientas de Diagramación y Documentación Viva](#adr-011-herramientas-de-diagramación-y-documentación-viva)
    - [ADR-012: Almacenamiento de Objetos para Documentos e Identidad](#adr-012-almacenamiento-de-objetos-para-documentos-e-identidad)
  - [4. Decisiones de Dominio y Reglas de Negocio (D-01 a D-06)](#4-decisiones-de-dominio-y-reglas-de-negocio-d-01-a-d-06)
    - [D-01: Modelado Unificado de Usuarios y Personal Bancario](#d-01-modelado-unificado-de-usuarios-y-personal-bancario)
    - [D-02: Clasificación de Cuentas (Monetarias vs. Ahorro)](#d-02-clasificación-de-cuentas-monetarias-vs-ahorro)
    - [D-03: Activación de Cuenta mediante Token Criptográfico Único](#d-03-activación-de-cuenta-mediante-token-criptográfico-único)
    - [D-04: Manejo Homogéneo de Errores en Autenticación](#d-04-manejo-homogéneo-de-errores-en-autenticación)
    - [D-05: Correo Electrónico como Identificador Primario de Acceso](#d-05-correo-electrónico-como-identificador-primario-de-acceso)
    - [D-06: Matriz de Control de Acceso y Autorización por Rol](#d-06-matriz-de-control-de-acceso-y-autorización-por-rol)
  - [5. Síntesis y Conclusiones Arquitectónicas](#5-síntesis-y-conclusiones-arquitectónicas)

---

## 1. Introducción y Propósito

El **Registro de Decisiones de Arquitectura (Architecture Decision Record - ADR)** es el instrumento formal de ingeniería que documenta las elecciones técnicas y estructurales tomadas durante el diseño y construcción de **Bank USAC**. Cada registro describe el **contexto** que motivó la decisión, la **solución adoptada**, las **alternativas descartadas** con su análisis comparativo, la **justificación** técnica vinculada a los drivers de calidad y negocio, y los **trade-offs (consecuencias)** asumidos.

Este documento unifica y traduce al español todas las decisiones distribuidas en el repositorio, consolidando la fundamentación arquitectónica del sistema bancario.

---

## 2. Matriz Resumen de Decisiones Arquitectónicas

| Código | Título de la Decisión | Solución Adoptada | Alternativa Principal Descartada | Driver / Justificación Clave |
|---|---|---|---|---|
| **ADR-001** | Ecosistema Backend | **Node.js 24 + TypeScript + NestJS** | Java (Spring Boot) / Go | Compartición de contratos `@bank/contracts` y rapidez de desarrollo. |
| **ADR-002** | Framework Frontend | **Nuxt 3 (Vue 3, TypeScript, SSR/SPA)** | React / Next.js / Angular | Paridad 1:1 con prototipo Claude Design y SSR nativo sin configuración compleja. |
| **ADR-003** | Modelo de Comunicación | **Asíncrono por Eventos (Broker) + Request/Reply en Gateway** | Llamadas HTTP síncronas directas / gRPC | Desacoplamiento temporal absoluto; un microservicio caído no detiene al resto. |
| **ADR-004** | Message Broker | **RabbitMQ 4.x (AMQP 0-9-1)** | Apache Kafka / Redis Streams | Enrutamiento flexible con Topics/Direct Exchanges y soporte nativo de Dead Letter Queues. |
| **ADR-005** | Persistencia y Aislamiento | **PostgreSQL 18 (Database per Service) + `NUMERIC(14,2)`** | Base de Datos Compartida / MongoDB | Cumplimiento ACID, aislamiento estricto y precisión contable sin redondeos. |
| **ADR-006** | Contenerización | **Docker Multi-Stage con usuario no-root (`node`, UID 1000)** | Imágenes monoproceso pesadas / Distroless | Seguridad en runtime sin privilegios root e imágenes ligeras optimizadas. |
| **ADR-007** | Orquestación | **Docker Compose (Local) + Kubernetes / Helm (Producción)** | Minikube local / Docker Swarm | Reproducibilidad local idéntica y estandarización para despliegues cloud en clúster. |
| **ADR-008** | Arquitectura Interna | **Clean Architecture / Hexagonal en cada Microservicio** | Arquitectura tradicional por capas acoplada | Independencia de frameworks; reglas de dominio puras testeables sin base de datos. |
| **ADR-009** | Transacciones Distribuidas | **Saga Coreografiada con Compensación Contable** | Two-Phase Commit (2PC) / Saga Orquestada | Cero bloqueos distribuidos de base de datos; resiliencia eventual determinista. |
| **ADR-010** | Autenticación y RBAC | **JWT Bearer + Hashing `scrypt` + Gateway `RolesGuard`** | Sesiones Stateful con Redis / OAuth2 externo | Autenticación stateless de alto rendimiento y control perimetral estricto (D-06). |
| **ADR-011** | Toolchain de Diagramación | **Fuentes de Texto Versionadas (Mermaid `.mmd` y PlantUML `.puml`)** | Diagramas binarios (Visio, Draw.io XML) | Trazabilidad git, revisión de cambios en Pull Requests y generación automatizada. |
| **ADR-012** | Almacenamiento de Objetos | **MinIO (S3-Compatible) + Hashes SHA-256 en Base de Datos** | BLOBs en PostgreSQL / FileSystem local | Desacoplamiento de almacenamiento no estructurado y aislamiento del broker. |

---

## 3. Decisiones de Arquitectura de Software y Ecosistema (ADR-001 a ADR-012)

---

### ADR-001: Ecosistema y Runtime del Backend

* **Título:** Selección de Node.js, TypeScript y NestJS como Plataforma Unificada de Microservicios.
* **Contexto:** El sistema se compone de 5 microservicios de dominio y 1 API Gateway que deben comunicarse mediante mensajes tipados y compartir esquemas de datos, validaciones y modelos de eventos sin duplicar código.
* **Decisión:** Utilizar **Node.js (v24.x LTS)** con **TypeScript** estricto y el framework **NestJS**, organizando el código en un monorepo gestionado por **pnpm workspaces** y **Turborepo**.
* **Alternativas Descartadas:**
  * *Java con Spring Boot:* Descartado por el alto consumo de memoria por contenedor (JVM) y mayor tiempo de arranque (*cold start*), lo cual encarece la infraestructura en entornos contenerizados locales.
  * *Go (Golang):* Descartado por la imposibilidad de compartir tipos y validadores Zod directamente entre el backend y el frontend web de forma transparente.
  * *Python (FastAPI):* Descartado por menor rendimiento en procesamiento de eventos asíncronos concurrentes de I/O frente al event loop de Node.js.
* **Justificación:**
  * **Atiende a EAC-04 (Modificabilidad) y EAC-06 (Portabilidad):** Permite el paquete compartido `@bank/contracts`, donde un solo cambio en el esquema de un evento compila y valida en tiempo de diseño todos los microservicios emisores, consumidores y el frontend.
  * **Atiende a RNF-09 (Monorepo):** Turborepo gestiona el pipeline de compilación en el orden de dependencias exacto con caché local determinista.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Tipado estático de extremo a extremo, productividad acelerada y menor huella de memoria por servicio (~80MB RAM por pod).
  * *Negativo:* Requiere disciplina de linters (`eslint-plugin-boundaries`) para evitar que capas internas importen dependencias de infraestructura accidentalmente.

---

### ADR-002: Ecosistema y Framework del Frontend

* **Título:** Implementación de la Interfaz Web con Nuxt 3, Vue 3 y Diseño Basado en Componentes.
* **Contexto:** Se requiere una interfaz web completa de 34 pantallas que dé soporte a los tres actores (Cliente, Cajero y Administrador), con navegación reactiva fluida, retroalimentación en tiempo real de operaciones asíncronas y renderizado del lado del servidor (SSR) para carga inicial instantánea.
* **Decisión:** Desarrollar la aplicación web en **Nuxt 3** (Vue 3, Composition API, TypeScript y TailwindCSS), conectándose exclusivamente al API Gateway.
* **Alternativas Descartadas:**
  * *React / Next.js:* Descartado debido a que la especificación visual y los prototipos de referencia estaban optimizados para la reactividad nativa y templates limpios de Vue.
  * *Single Page Application tradicional (Vite puro sin SSR):* Descartado porque carece de enrutamiento basado en archivos preconfigurado y requiere configuración manual compleja para guardias de autenticación y layouts por rol.
* **Justificación:**
  * **Atiende a EAC-01 (Usabilidad) y EAC-03 (Seguridad):** Nuxt 3 ofrece middleware de navegación nativo que intercepta rutas no autorizadas en el cliente antes de renderizar la vista, complementando la seguridad del Gateway.
  * **Paridad de Diseño:** Implementación fiel de las 34 pantallas del prototipo visual sin dependencias externas pesadas.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Carga ultrarrápida, gestión limpia de estado reactivo y separación clara entre lógica (`app/lib/`) y vistas (`app/pages/`).
  * *Negativo:* Curva de aprendizaje en la gestión de renderizado híbrido (SSR vs. hidratación en cliente) para componentes que leen storage del navegador.

---

### ADR-003: Modelo de Comunicación Inter-Servicios

* **Título:** Comunicación Asíncrona Basada en Eventos para Dominio y Request/Reply Asíncrono en Gateway.
* **Contexto:** En una arquitectura de microservicios bancarios, el acoplamiento síncrono mediante llamadas HTTP REST directas entre servicios genera problemas de cascada de fallos (*cascading failures*), bloqueos de hilos y dependencia de disponibilidad simultánea de todos los componentes.
* **Decisión:** 
  1. **Prohibir llamadas HTTP directas entre microservicios de dominio.**
  2. Toda interacción de negocio viaja como un mensaje sobre RabbitMQ mediante el sobre estándar `@bank/contracts` (`Envelope`).
  3. El API Gateway utiliza el patrón **Request/Reply asíncrono sobre colas temporales exclusivas** con un techo estricto de espera de 5 segundos para peticiones que requieren respuesta inmediata al cliente.
* **Alternativas Descartadas:**
  * *REST síncrono punto a punto (HTTP/JSON):* Descartado porque si el servicio de cuentas está ocupado, el servicio de transacciones fallaría la solicitud, degradando la disponibilidad global.
  * *gRPC síncrono:* Descartado por mantener el acoplamiento temporal entre servicios y requerir balanceadores de carga L7 complejos.
* **Justificación:**
  * **Atiende a EAC-01 (Disponibilidad) y EAC-04 (Desacoplamiento):** Si un microservicio se reinicia o está bajo carga pesada, los mensajes permanecen seguros en la cola de RabbitMQ y se procesan en cuanto el servicio se restablece, sin perder transacciones.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Tolerancia a fallos transitorios, procesamiento en paralelo y absorción de picos de tráfico.
  * *Negativo:* Mayor complejidad en el rastreo de flujos, mitigado mediante la inyección obligatoria de `correlationId` en cada sobre.

---

### ADR-004: Broker de Mensajería Asíncrona

* **Título:** Selección de RabbitMQ 4.x como Message Broker Central.
* **Contexto:** El sistema requiere enrutar comandos dirigidos a colas específicas de servicios, transmitir eventos de dominio en abanico (*fan-out / topic*) hacia auditoría, y soportar reintentos con retraso y colas de descarte (*Dead Letter Exchanges*).
* **Decisión:** Adoptar **RabbitMQ (AMQP 0-9-1)** configurado con exchanges temáticos (`bank.commands`, `bank.events`, `bank.queries`, `bank.errors`) y colas durables por microservicio.
* **Alternativas Descartadas:**
  * *Apache Kafka:* Descartado por sobredimensionamiento arquitectónico para la escala del proyecto y complejidad operativa (requiere gestión de particiones, offsets y ZooKeeper/KRaft), además de carecer de soporte nativo simple para colas de reintentos individuales y RPC request/reply directo.
  * *Redis Pub/Sub:* Descartado porque no ofrece persistencia confiable de mensajes ni confirmaciones manuales de entrega (ACKs/NACKs).
  * *AWS SQS / SNS:* Descartado para mantener la portabilidad del sistema en entornos locales y nubes privadas sin atarse a un proveedor propietario (*vendor lock-in*).
* **Justificación:**
  * **Atiende a RNF-10 (Resiliencia) y EAC-02 (Rendimiento):** RabbitMQ maneja colas en memoria con persistencia en disco, entrega con ACK manual, reintentos con TTL y DLQ en el exchange `bank.errors` de forma nativa y robusta.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Gestión visual en tiempo real mediante interfaz web (`localhost:15672`), baja latencia (<5ms) y topología declarativa automatizada al arrancar los servicios.
  * *Negativo:* Requiere monitorear la memoria del broker para evitar que colas no consumidas saturen el servidor.

---

### ADR-005: Motor de Persistencia y Estrategia de Aislamiento de Datos

* **Título:** Adopción de PostgreSQL 18.x con Patrón "Database per Service" y Aritmética Exacta.
* **Contexto:** La integridad del dinero exige garantías ACID completas. Además, la regla constitucional de microservicios prohíbe que un servicio consulte o altere las tablas de otro.
* **Decisión:**
  1. Asignar **una base de datos PostgreSQL independiente a cada microservicio** (`customer_db`, `account_db`, `transaction_db`, `payment_db`, `notification_audit_db`), con credenciales de usuario y puertos aislados.
  2. Manejar todos los valores monetarios con tipo **`NUMERIC(14,2)`** y aritmética exacta en punto fijo (centavos en enteros en contratos: `amountMinor`).
  3. Proteger saldos y estados concurrentes mediante bloqueos pesimistas de fila **`SELECT ... FOR UPDATE`**, control de versión optimista (`version`) y restricciones duras de base de datos **`CHECK (balance >= 0)`**.
* **Alternativas Descartadas:**
  * *Base de Datos Compartida (Shared Database):* Descartada por violar el principio de microservicios, generar acoplamiento a nivel de esquema e impedir el escalado independiente.
  * *Bases de Datos NoSQL (MongoDB / Cassandra):* Descartadas por falta de transacciones ACID nativas multi-documento con bloqueos de fila pesimistas, esenciales para evitar la condición de carrera en dobles débitos bancarios.
* **Justificación:**
  * **Atiende a EAC-02 (Consistencia Financiera) y RES-01 (Database per Service):** Garantiza que dos débitos concurrentes nunca sobregiren una cuenta y que ninguna caída en una base de datos afecte la persistencia de las otras.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Integridad contable blindada a nivel de motor SQL y aislamiento estricto de datos.
  * *Negativo:* Prohibición de realizar `JOINs` SQL entre servicios; la agregación de datos (ej. nombre del cliente + cuenta) debe realizarse en el API Gateway mediante composición de consultas.

---

### ADR-006: Estrategia de Contenerización e Imágenes Base

* **Título:** Construcción de Imágenes Docker Multi-Stage con Ejecución No Privilegiada (`node`).
* **Contexto:** Se requiere empaquetar los 7 componentes del sistema en contenedores seguros, livianos, reproducibles y listos para producción, minimizando la superficie de ataque de vulnerabilidades de seguridad.
* **Decisión:** Crear **Dockerfiles multi-stage específicos por servicio**, utilizando imágenes base oficiales de Node.js Alpine/Slim, compilando en la primera etapa y copiando únicamente los artefactos de producción (`dist/` y `node_modules` de producción) en la etapa final, ejecutando los procesos bajo el usuario sin privilegios **`node` (UID 1000)**.
* **Alternativas Descartadas:**
  * *Imágenes Monolíticas / Todo en Uno:* Descartadas por generar imágenes de más de 1.5 GB con herramientas de compilación innecesarias en runtime.
  * *Ejecución como usuario `root`:* Descartada por constituir una mala práctica de seguridad crítica que permite la fuga de privilegios en contenedores.
* **Justificación:**
  * **Atiende a EAC-03 (Seguridad) y EAC-06 (Portabilidad):** Imágenes reducidas a menos de 180 MB, sin secretos quemados en el código y con variables inyectadas exclusivamente en tiempo de ejecución.
  * **Sondas de Salud Desacopladas:** El puerto HTTP se abre *antes* de esperar a la base de datos o broker, evitando que una reconexión transitoria reinicie el contenedor en bucle (*CrashLoopBackOff*).
* **Consecuencias (Trade-offs):**
  * *Positivo:* Despliegues rápidos, bajo consumo de disco y cumplimiento de directivas de seguridad bancaria.
  * *Negativo:* Requiere mantener configuraciones multi-stage en los 7 Dockerfiles.

---

### ADR-007: Estrategia de Orquestación Local y en la Nube

* **Título:** Orquestación Local con Docker Compose y Despliegue en Producción con Kubernetes / Helm.
* **Contexto:** El equipo requiere levantar la infraestructura completa en local con un solo comando para desarrollo y pruebas, mientras que en producción se exige alta disponibilidad y escalado automático sobre Kubernetes.
* **Decisión:**
  1. En **desarrollo local**: utilizar **Docker Compose** (`infra/docker/docker-compose.dev.yml`) para levantar los 15 contenedores (Gateway, Web, 5 microservicios, 5 PostgreSQL, RabbitMQ y MinIO) con redes y variables preconfiguradas.
  2. En **producción / evaluación en clúster**: empaquetar la solución en un **Helm Chart unificado** (`infra/k8s/helm/bank-usac`) desplegable sobre clústeres Kubernetes (ej. kind, EKS o GKE).
* **Alternativas Descartadas:**
  * *Docker Swarm:* Descartado por menor soporte en la industria y falta de capacidades avanzadas de gestión de secretos y políticas de red que sí posee Kubernetes.
  * *Levantar servicios manualmente en terminales separadas:* Descartado por ser propenso a errores humanos de configuración de puertos y variables de entorno.
* **Justificación:**
  * **Atiende a EAC-06 (Portabilidad) y EAC-01 (Disponibilidad):** Permite pasar de un entorno de pruebas en una laptop a un clúster multinodo en la nube sin cambiar una sola línea de código fuente.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Entornos de desarrollo y producción consistentes y automatizados.
  * *Negativo:* Demanda recursos de hardware considerables en la máquina local para ejecutar los 15 contenedores en paralelo (~4GB RAM libres).

---

### ADR-008: Arquitectura Interna de los Microservicios (Clean Architecture)

* **Título:** Estructuración Interna de Microservicios mediante Clean Architecture / Puertos y Adaptadores.
* **Contexto:** Para evitar que la lógica bancaria quede acoplada a NestJS, PostgreSQL o RabbitMQ, se requiere una separación formal de capas donde el núcleo del negocio sea independiente de la tecnología.
* **Decisión:** Implementar **Clean Architecture (Arquitectura Hexagonal)** en los 5 microservicios dividida en 4 capas estrictas:
  1. **`domain/`**: Entidades puras, objetos de valor (*Value Objects*), máquinas de estado y reglas invariantes. Cero dependencias externas.
  2. **`application/`**: Casos de uso (*Use Cases*), puertos de entrada/salida e interfaces de repositorios y publicadores.
  3. **`infrastructure/`**: Adaptadores concretos (TypeORM/Prisma/pg, adaptadores de RabbitMQ y clientes MinIO).
  4. **`interfaces/`**: Controladores de mensajes (*Message Handlers*) y endpoints HTTP del Gateway.
* **Alternativas Descartadas:**
  * *Arquitectura tradicional por capas (Controller-Service-Repository acoplado):* Descartada porque los servicios terminarían importando decoradores de NestJS y entidades de base de datos dentro de las reglas de cálculo financiero, haciendo imposible probar el dominio en aislamiento.
* **Justificación:**
  * **Atiende a EAC-04 (Modificabilidad) y RNF-09 (Aislamiento):** Las reglas de la máquina de estados de transferencias o el cálculo de saldos se prueban como funciones puras en milisegundos con suites de pruebas unitarias sin levantar bases de datos ni mocks complejos.
  * **Verificación por Linter:** `apps/packages/tooling/eslint.base.mjs` falla la compilación si un archivo de `domain` intenta importar algo de `infrastructure`.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Alta mantenibilidad, código autidocumentado y facilidad para sustituir tecnologías de persistencia o mensajería.
  * *Negativo:* Mayor cantidad inicial de archivos e interfaces por cada caso de uso (*boilerplate*).

---

### ADR-009: Transacciones Distribuidas y Consistencia (Saga Coreografiada)

* **Título:** Implementación del Patrón Saga Coreografiada con Compensación Automática.
* **Contexto:** Una transferencia de dinero involucra 4 servicios: *Transaction Service* (registro), *Account Service* (débito en origen), *Payment Service* (cobro de pasarela/biller) y *Account Service* (crédito en destino). Bloquear las bases de datos de todos los servicios durante la operación es inviable.
* **Decisión:** Implementar una **Saga Coreografiada** basada en eventos asíncronos con una máquina de estados finita de 6 estados:
  $$\text{PENDING} \longrightarrow \text{DEBITING} \longrightarrow \text{PAYMENT\_PENDING} \longrightarrow \text{CREDITING} \longrightarrow \text{COMPLETED}$$
  Si ocurre un fallo en el cobro o en el crédito destino, la Saga transiciona hacia **`COMPENSATING`** emitiendo un comando de compensación que devuelve el dinero a la cuenta de origen y concluye en **`COMPENSATED`**.
* **Alternativas Descartadas:**
  * *Two-Phase Commit (2PC / XA Transactions):* Descartado porque introduce un coordinador central síncrono que bloquea tablas distribuidas, creando cuellos de botella severos y puntos únicos de fallo.
  * *Saga Orquestada Centralizada:* Descartada para evitar que un único orquestador concentre la lógica de todos los dominios, prefiriendo que cada microservicio reaccione autónomamente a los eventos del negocio.
* **Justificación:**
  * **Atiende a EAC-02 (Consistencia Financiera) y EAC-01 (Disponibilidad):** Garantiza que ante cualquier error (fondos insuficientes, timeout de red o pasarela caída), el saldo contable siempre sea consistente: el dinero se transfiere exitosamente o se devuelve en su totalidad.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Altísimo rendimiento transaccional, sin bloqueos distribuidos y resiliencia determinista.
  * *Negativo:* Consistencia eventual (los estados intermedios duran fracciones de segundo mientras viajan los eventos por RabbitMQ).

---

### ADR-010: Autenticación, Sesiones y Autorización por Roles (RBAC)

* **Título:** Autenticación Stateless con JWT, Cifrado `scrypt` y Autorización Perimetral en Gateway (ADR D-06).
* **Contexto:** Se requiere proteger los endpoints del banco, autenticar a los 3 tipos de actores y aplicar la matriz de permisos D-06 sin mantener sesiones pesadas en memoria del servidor.
* **Decisión:**
  1. Utilizar **Bearer JWT** firmado con clave secreta asimétrica/HMAC-SHA256, con tiempo de expiración corto (1 hora) y claims de identidad (`customerId`, `role`, `status`).
  2. Almacenar las contraseñas en `Customer Service` utilizando el algoritmo de derivación de claves criptográficas **`scrypt`** con salting dinámico.
  3. Centralizar la autorización en el API Gateway mediante el guardia **`RolesGuard`**, el cual valida el rol antes de permitir la entrada a cualquier ruta.
* **Alternativas Descartadas:**
  * *Sesiones en Servidor con Almacén Redis (Stateful Sessions):* Descartado porque introduce una dependencia de red crítica adicional para cada petición HTTP entrante.
  * *Basic Authentication:* Descartado por transmitir credenciales en cada petición, lo cual es inaceptable en estándares de seguridad financiera.
* **Justificación:**
  * **Atiende a EAC-03 (Seguridad) y RNF-04/05 (Cifrado y RBAC):** Verificación instantánea en el Gateway sin consultar bases de datos en cada request, garantizando que clientes no puedan acceder a operaciones de cajero o administración.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Escalabilidad horizontal sin estado, seguridad perimetral estricta y protección contra ataques de fuerza bruta.
  * *Negativo:* Los JWT emitidos no pueden revocarse antes de su expiración sin mantener una lista negra de tokens revocados.

---

### ADR-011: Herramientas de Diagramación y Documentación Viva

* **Título:** Adopción de Mermaid y PlantUML como Fuentes Versionadas de Diagramación.
* **Contexto:** Los diagramas arquitectónicos y de casos de uso suelen quedar obsoletos si se guardan en formatos binarios o herramientas propietarias fuera del repositorio git.
* **Decisión:** Escribir todos los diagramas de arquitectura, componentes, secuencia y casos de uso en **código de texto plano versionable** utilizando **Mermaid (`.mmd`)** y **PlantUML (`.puml`)** dentro de la carpeta `docs/architecture/diagrams/`, generando automáticamente las exportaciones PNG en el pipeline de documentación.
* **Alternativas Descartadas:**
  * *Archivos binarios (Microsoft Visio / Enterprise Architect):* Descartados porque impiden ver diferencias (*diffs*) de código en Pull Requests y dificultan el trabajo colaborativo.
  * *Imágenes PNG/JPEG sueltas sin código fuente:* Descartadas por ser imposibles de mantener y actualizar de forma automatizada.
* **Justificación:**
  * **Atiende a EAC-04 (Mantenibilidad) y RNF-09:** Todo cambio en la arquitectura se documenta en el mismo Pull Request donde se modifica el código fuente, garantizando sincronía total entre diseño e implementación.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Documentación viva, trazabilidad git completa y renderizado directo en GitHub y editores Markdown.
  * *Negativo:* Limitaciones estéticas en la disposición de cajas complejas frente a editores manuales de dibujo libre.

---

### ADR-012: Almacenamiento de Objetos para Documentos e Identidad

* **Título:** Integración de MinIO (S3-Compatible) para Fotografías de Documentos de Identificación (DPI).
* **Contexto:** El proceso de registro exige que los clientes carguen una fotografía de su documento DPI (hasta 5 MB) para su posterior validación en ventanilla por un cajero. Almacenar imágenes binarias pesadas dentro de las bases de datos PostgreSQL o enviarlas a través del broker RabbitMQ satura la red y degrada la memoria.
* **Decisión:**
  1. Desplegar un servicio de almacenamiento de objetos **MinIO** compatible con el API de Amazon S3.
  2. El API Gateway recibe el archivo multipart, calcula su digest criptográfico **SHA-256**, lo deposita en el bucket seguro de MinIO y transfiere únicamente la **referencia del objeto (`PhotoReference`)** y su hash hacia `Customer Service`.
  3. Para la inspección del cajero, el Gateway expone la ruta `GET /api/customers/:id/identity-document`, la cual hace streaming directo de la imagen desde MinIO hacia el navegador.
* **Alternativas Descartadas:**
  * *Almacenar fotos como columnas `BYTEA` / BLOBs en PostgreSQL:* Descartado porque infla el tamaño de la base de datos relacional, ralentiza los backups transaccionales y degrada el caché de páginas de memoria del motor SQL.
  * *Transmitir fotos como payloads Base64 por RabbitMQ:* Descartado porque el broker está diseñado para mensajes JSON ligeros (< 100 KB); saturarlo con archivos binarios provocaría caídas de rendimiento masivas en las colas.
* **Justificación:**
  * **Atiende a EAC-02 (Rendimiento) y EAC-03 (Seguridad):** La base de datos solo guarda metadatos ligeros y hashes inmutables, el broker opera a máxima velocidad y las imágenes se almacenan en un subsistema especializado en objetos binarios.
* **Consecuencias (Trade-offs):**
  * *Positivo:* Escalabilidad ilimitada de archivos, streaming de alto rendimiento y verificación de integridad biométrica por hash SHA-256.
  * *Negativo:* Introduce un contenedor de infraestructura adicional (MinIO) que debe estar disponible durante el registro.

---

## 4. Decisiones de Dominio y Reglas de Negocio (D-01 a D-06)

---

### D-01: Modelado Unificado de Usuarios y Personal Bancario
* **Decisión:** Los roles `ADMINISTRADOR` y `CAJERO_RECEPTOR` son registros dentro de la tabla `customers` de `Customer Service` con un atributo `role` elevado, en lugar de constituir tablas o microservicios separados de empleados.
* **Justificación:** Mantiene un único flujo de autenticación, evita duplicar infraestructura de login y preserva el significado unívoco de `customerId`. Los empleados no poseen cuentas bancarias operativas (`Account`), lo cual es validado por la regla de negocio `ROLE_NOT_ELIGIBLE`.

### D-02: Clasificación de Cuentas (Monetarias vs. Ahorro)
* **Decisión:** Se modelan y permiten abrir cuentas de tipo `MONETARIA` y de tipo `AHORRO`, compartiendo la misma semántica contable base en la fase actual.
* **Justificación:** Cumple con la taxonomía de productos bancarios exigida por el enunciado sin introducir prematuramente cron jobs complejos de capitalización periódica de intereses.

### D-03: Activación de Cuenta mediante Token Criptográfico Único
* **Decisión:** La activación de usuarios se realiza mediante un token criptográfico temporal (24 horas) de **un solo uso** emitido por `Customer Service` y entregado por `Notification Service`.
* **Justificación:** Garantiza que nadie pueda operar en la plataforma sin haber demostrado control sobre la dirección de correo electrónico registrada, previniendo suplantaciones de identidad.

### D-04: Manejo Homogéneo de Errores en Autenticación
* **Decisión:** Contraseñas incorrectas, correos no registrados o cuentas pendientes de activación devuelven el **mismo mensaje de error genérico con código HTTP 401**.
* **Justificación:** **Seguridad Ofensiva:** Impide ataques de enumeración de usuarios en los que un atacante podría deducir qué correos pertenecen a clientes del banco a partir de diferencias en las respuestas del servidor.

### D-05: Correo Electrónico como Identificador Primario de Acceso
* **Decisión:** El inicio de sesión se realiza con el **correo electrónico** y la contraseña, mientras que el `username` generado actúa como identificador público secundario.
* **Justificación:** El correo electrónico garantiza unicidad universal verificable mediante el flujo de activación, mientras que los nombres de usuario generados automáticamente pueden requerir sufijos numéricos ante colisiones de nombres.

### D-06: Matriz de Control de Acceso y Autorización por Rol
* **Decisión:** Implementar una matriz formal de privilegios donde:
  * `CLIENTE` solo opera sobre sus propias cuentas, transferencias y notificaciones.
  * `CAJERO_RECEPTOR` gestiona ventanilla (depósitos y validación de DPI), pero no puede consultar auditoría ni alterar estados de cuenta.
  * `ADMINISTRADOR` posee acceso a la auditoría forense distribuida, monitoreo global de pagos y activación/bloqueo de cuentas.
* **Justificación:** Principio de menor privilegio bancario (*Least Privilege*), asegurando que el personal de caja no tenga acceso a los registros de auditoría que vigilan sus propias operaciones.

---

## 5. Síntesis y Conclusiones Arquitectónicas

1. **Ecosistema Coherente y Tipado:** La elección de TypeScript en todo el monorepo (NestJS en backend y Nuxt 3 en frontend) maximiza la reutilización de contratos y elimina por completo los errores de discrepancia de tipos en tiempo de ejecución.
2. **Resiliencia Transaccional sin Acoplamiento:** La combinación de **RabbitMQ**, **PostgreSQL con bloqueos pesimistas** y el patrón **Saga Coreografiada** proporciona un sistema capaz de manejar transferencias bancarias de alta concurrencia con consistencia contable matemática.
3. **Seguridad y Privacidad por Diseño:** El aislamiento perimetral mediante JWT, la redacción previa a la inserción en auditoría, el hashing con `scrypt` y el almacenamiento de fotos en MinIO aseguran el cumplimiento riguroso de las directivas de seguridad bancaria.
4. **Trazabilidad y Mantenibilidad:** La adopción de Clean Architecture y la diagramación en código garantizan que el sistema sea comprensible, auditable y fácilmente extensible para futuras fases de evolución institucional.
