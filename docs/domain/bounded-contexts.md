# Contextos Delimitados (Bounded Contexts) y Propiedad de Datos — Bank USAC

> *"Bounded Contexts establece los límites de responsabilidad del dominio bancario, definiendo qué conceptos y reglas pertenecen a cada microservicio y evitando el acoplamiento entre ellos."* — Kevin Raúl Pozuelos Estrada (Auxiliar del Curso)

Este documento define la frontera de responsabilidad de cada uno de los **cinco microservicios** de Bank USAC, la propiedad exclusiva de los datos (*Data Ownership*), qué servicios pueden leerlos mediante mensajería y qué datos **jamás deben cruzar** la frontera de su servicio de origen.

---

## 1. ¿Qué es un Bounded Context en Bank USAC?

En **Domain-Driven Design (DDD)**, un *Bounded Context* (Contexto Delimitado) es el límite explícito dentro del cual un modelo de dominio se aplica con un significado único y preciso:

* Un mismo concepto (por ejemplo, el "Cliente") no significa lo mismo en todas partes:
  * Para **Customer Service**, el cliente es una **entidad de identidad**: tiene nombre, DPI, fotografía, contraseña `scrypt`, correo y estado de validación.
  * Para **Account Service**, el cliente no es una persona ni tiene contraseña: es simplemente un identificador opaco (`customerId: UUID`) al que se le asocian cuentas y saldos monetarios.
  * Para **Transaction Service**, el cliente ni siquiera existe directamente: solo existen identificadores de cuenta origen y cuenta destino.

Dividir el sistema en Bounded Contexts garantiza la regla de oro de la rúbrica: **ningún servicio es un "Objeto Dios" (God Object)** y **cada microservicio es dueño absoluto de su propia base de datos**.

---

## 2. Los Cinco Contextos Delimitados

| Bounded Context | Responsabilidad Única | Entidades y Datos que Posee Exclusivamente |
|---|---|---|
| **Customer Service** | Identidad del cliente, autenticación y credenciales | `Customer`: datos personales, DPI, fotografía, username, credencial `scrypt`, rol, estado de activación y verificación de correo. |
| **Account Service** | Cuentas bancarias y saldos contables exactos | `Account`: saldos en `NUMERIC(14,2)`, estado de cuenta, tipo (Monetaria/Ahorro), historial de operaciones y desactivación automática. |
| **Transaction Service** | Orquestación y máquina de estados de transferencias (Saga) | `Transaction`: cuenta origen, cuenta destino, monto, correlación y estados de la Saga (`PENDING` a `COMPLETED` o `COMPENSATED`). |
| **Payment Service** | Procesamiento de cobros a facturadores externos | `Payment`: referencia de transacción, estado de cobro, reintentos escalonados y escenarios de prueba. |
| **Notification & Audit** | Bitácora global inmutable y buzón de notificaciones | `AuditEvent` (payloads redactados) y `Notification` (destinatario, canal, lectura). |

### El API Gateway no es un Bounded Context de Dominio
El API Gateway **no posee entidades de negocio y no tiene base de datos**. Su única función es perimetral: autenticar JWTs, validar autorizaciones RBAC, generar el `correlationId` y transformar peticiones HTTP en comandos AMQP. **El Gateway jamás toma decisiones de negocio** (como autorizar un saldo o validar una cuenta); de hacerlo, violaría la rúbrica al convertirse en un "Gateway Orquestador".

---

## 3. Propiedad de Datos vs. Referencia Opaca

Confundir propiedad con referencia es la principal causa de acoplamiento destructivo:

* **Propiedad (*Ownership*)**: Es el derecho exclusivo de un servicio a escribir y modificar un atributo en su base de datos. Solo un servicio puede ser dueño de un dato.
* **Referencia Opaca**: Es almacenar el identificador (`UUID`) generado por otro servicio como un simple valor ciego.
  * `Account Service` almacena `customerId`, pero no sabe ni le interesa el nombre, el teléfono ni la contraseña del cliente. Jamás consulta la base de datos de Customer Service para averiguarlo.
  * `Transaction Service` almacena `sourceAccount` y `targetAccount`, pero **jamás lee ni modifica el saldo directamente**; emite un comando de débito y espera el veredicto en un evento asíncrono.

---

## 4. Matriz de Propiedad y Flujo de Datos

Un único escritor por atributo. Los consumidores reciben datos únicamente mediante mensajes asíncronos por RabbitMQ. **Ninguna fila de esta matriz se satisface leyendo la base de datos de otro servicio.**

### A. Customer Service
| Atributo | Dueño Exclusivo | Consumidores | Mecanismo de Transporte |
|---|---|---|---|
| `customerId` | Customer Service | Account (referencia opaca), Audit | Evento RabbitMQ |
| Nombre completo | Customer Service | Notification & Audit | Evento RabbitMQ |
| Documento DPI | Customer Service | Ninguno | **No cruza el límite** |
| Contraseña / Credencial | Customer Service | Ninguno | **Jamás cruza (ni encriptada)** |
| Fotografía de DPI | Customer Service | Ninguno (almacenada en MinIO) | **No cruza el límite** |
| Correo electrónico | Customer Service | Notification & Audit | Evento (únicamente para despacho) |
| Rol (`CLIENTE`, etc.) | Customer Service | API Gateway | Async Request/Reply tras Login |
| Estado de validación | Customer Service | Notification & Audit | Evento RabbitMQ |

### B. Account Service
| Atributo | Dueño Exclusivo | Consumidores | Mecanismo de Transporte |
|---|---|---|---|
| `accountId` | Account Service | Transaction (referencia), Audit | Evento RabbitMQ |
| `balance` (Saldo) | **Account, y solo Account** | Gateway (solo para consulta de saldo) | Async Request/Reply |
| Estado de cuenta | Account Service | Notification & Audit | Evento RabbitMQ |
| Tipo de cuenta | Account Service | Notification & Audit | Evento RabbitMQ |
| `lastActivityAt` | Account Service | Ninguno (interno para desactivación) | **No cruza el límite** |

> **Regla de Oro del Saldo:** El atributo `balance` es el más sensible del sistema. **Transaction Service jamás lo lee.** Ordena un débito y espera el evento `account.debited.v1` o el rechazo por fondos insuficientes. Diseñar una verificación previa de saldo desde Transaction Service viola el aislamiento del dominio.

### C. Transaction Service
| Atributo | Dueño Exclusivo | Consumidores | Mecanismo de Transporte |
|---|---|---|---|
| `transactionId` | Transaction Service | Payment (referencia), Audit | Evento RabbitMQ |
| Cuentas origen / destino | Transaction Service | Account (como orden de débito/crédito), Audit | Evento RabbitMQ |
| Monto (`amount`) | Transaction Service | Account, Payment, Audit | Evento RabbitMQ |
| Estado de la Saga | Transaction Service | Notification & Audit | Evento RabbitMQ |
| `correlationId` | API Gateway (lo acuña) | Todos los servicios | Envolvente estándar en cada mensaje |
| `idempotencyKey` | Transaction Service | Ninguno | **No cruza el límite** |

### D. Payment Service
| Atributo | Dueño Exclusivo | Consumidores | Mecanismo de Transporte |
|---|---|---|---|
| `paymentId` | Payment Service | Notification & Audit | Evento RabbitMQ |
| `status` de pago | Payment Service | Transaction Service | Evento (`succeeded` / `failed`) |
| Contador de intentos | Payment Service | Notification & Audit | Evento `attempt.failed` |
| Razón de fallo | Payment Service | Transaction Service, Audit | Evento RabbitMQ |

### E. Notification & Audit Service
| Atributo | Dueño Exclusivo | Consumidores | Mecanismo de Transporte |
|---|---|---|---|
| `AuditEvent` | Notification & Audit | Ninguno (servicio terminal) | Almacenamiento local inmutable |
| `Notification` | Notification & Audit | Cliente (vía buzón personal) | Consulta en API Gateway |

---

## 5. Datos que Jamás Deben Cruzar los Límites del Servicio

| Dato Sensible | Permanece en | Justificación Arquitectónica y de Seguridad |
|---|---|---|
| Credenciales / Hash `scrypt` | Customer Service | Transmitir contraseñas por el broker, incluso cifradas, es una fuga de seguridad inaceptable. |
| Fotografía del DPI | Customer Service | El dato biométrico y personal más sensible; ningún otro servicio tiene justificación para verlo. |
| Número completo de DPI | Customer Service | La auditoría no lo persiste; para identificar a una persona se utiliza el identificador opaco `customerId`. |
| Saldo (`balance`) | Account Service | Solo se expone al usuario final en la consulta de saldo. Jamás viaja en los eventos de la Saga. |
| `lastActivityAt` | Account Service | Entrada privada del proceso automático de desactivación por inactividad. |

---

## 6. Prohibición Absoluta de Bases de Datos Compartidas

En cumplimiento estricto de la rúbrica del curso:
* **Un microservicio que consulte directamente la base de datos de otro microservicio es penalizado con el 50% de la nota** (§4.2).
* **Utilizar una sola base de datos compartida para todos los servicios es penalizado con el 100% de la nota (reprobación inmediata)** (§8.3).

Por esta razón, Bank USAC despliega cinco instancias físicamente aisladas de PostgreSQL 18.4, comunicadas única y exclusivamente a través de mensajes asíncronos en RabbitMQ.
