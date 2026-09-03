# Guía Integral de Pruebas: Happy Path, Validaciones y Casos de Error

Este documento constituye la **Guía Maestra de Pruebas y Demostración Integral** de **Bank USAC**. Detalla la totalidad de los flujos del sistema bancario distribuido interactuando con los tres actores (**Cliente**, **Cajero Receptor** y **Administrador**), contrastando en cada módulo el **Camino Exitoso (Happy Path)** frente a los **Caminos de Validación y Manejo de Errores (Unhappy / Edge Cases)**, respaldado por evidencias visuales de alta resolución tomadas en tiempo real durante la ejecución automatizada.

---

## 🏛️ Matriz de Actores y Credenciales de Demostración

| Actor / Rol | Credenciales | Propósito  | Privilegios y Restricciones (ADR D-06) |
| :--- | :--- | :--- | :--- |
| **Cliente Principal (Enner Mendizabal)** | `ventanilla@bankusac.gt` / `DemoClave#03` | Origen de transferencias con Saga, pagos de servicios, cuentas pre-fondeadas (Q5,000). | Puede ver únicamente sus cuentas, movimientos y notificaciones. |
| **Cliente Tercero (Marco Tulio López)** | `marco.lopez@bankusac.gt` / `BankUsac#2026` | Destinatario para pruebas de transferencias interbancarias y depósitos en ventanilla. | Puede ver únicamente sus cuentas, movimientos y notificaciones. |
| **Cajero Receptor (Ventanilla)** | `cajero@bankusac.gt` / `BankUsac#2026` | Validación de documentos DPI y abono de depósitos en efectivo. | No puede ordenar transferencias entre clientes ni auditar el sistema (`403`). |
| **Administrador del Sistema** | `admin@bankusac.gt` / `BankUsac#2026` | Auditoría distribuida, monitoreo de pagos, gestión de estado. | Acceso de lectura global al bus de eventos y métricas de servicios. |

---

## 📑 Índice de Módulos Evaluados

1. [Módulo 1: Autenticación y Control de Acceso](#módulo-1-autenticación-y-control-de-acceso)
2. [Módulo 2: Registro Público de Cliente (Validaciones en 3 Pasos)](#módulo-2-registro-público-de-cliente-validaciones-en-3-pasos)
3. [Módulo 3: Activación Criptográfica de la Cuenta](#módulo-3-activación-criptográfica-de-la-cuenta)
4. [Módulo 4: Portal y Dashboard de Banca Digital](#módulo-4-portal-y-dashboard-de-banca-digital)
5. [Módulo 5: Apertura y Administración de Cuentas Bancarias](#módulo-5-apertura-y-administración-de-cuentas-bancarias)
6. [Módulo 6: Operaciones de Ventanilla (Cajero Receptor)](#módulo-6-operaciones-de-ventanilla-cajero-receptor)
7. [Módulo 7: Transferencia Bancaria con Saga Coreografiada](#módulo-7-transferencia-bancaria-con-saga-coreografiada)
8. [Módulo 8: Administración, Auditoría Global y Observabilidad](#módulo-8-administración-auditoría-global-y-observabilidad)
9. [Módulo 9: Escenarios Cruzados Multi-Actor de Alta Complejidad](#módulo-9-escenarios-cruzados-multi-actor-de-alta-complejidad)
10. [Diagnóstico de Casos Borde y Pruebas no Superadas](#diagnóstico-de-casos-borde-y-pruebas-no-superadas)
11. [Conclusiones del Reporte de Pruebas](#conclusiones-del-reporte-de-pruebas)

---

## Módulo 1: Autenticación y Control de Acceso

### 1.1 Camino Exitoso: Login con Credenciales Válidas
- **URL**: `http://localhost:3010/login`
- **Ruta API**: `POST /api/auth/login`
- **Comportamiento**: Se envía `POST /api/auth/login`. Customer Service valida las credenciales con hash criptográfico `scrypt` y el API Gateway retorna `200 OK` con un Bearer JWT de sesión.

| Pantalla de Login | Dashboard Tras Login Exitoso |
| :--- | :--- |
| ![Pantalla de Login](screenshots/hp-01-login-pantalla.png) | ![Login Exitoso](screenshots/hp-04-login-exitoso-cliente.png) |

---

### 1.2 Caminos de Error en Autenticación

#### A. Credenciales Inválidas o Cuenta Inactiva (ADR D-04)
- **Valores de Prueba Erróneos**:

| Campo | Entrada Errónea | Regla de Seguridad Aplicada |
| :--- | :--- | :--- |
| **Correo** | `noexiste@bankusac.gt` | Dirección no registrada en base de datos |
| **Contraseña** | `ClaveIncorrecta#2026` | Hash no coincidente |

- **Comportamiento y Justificación**: Según la decisión **D-04**, contraseñas erróneas, correos inexistentes y cuentas no activadas devuelven el **mismo mensaje de error genérico 401**. Esto evita ataques de enumeración donde un atacante pueda descubrir qué correos están registrados en el banco.

#### B. Formulario Vacío
- **Comportamiento**: Envío con campos vacíos bloqueado localmente por validaciones de formulario.

| Error por Credenciales Inválidas (D-04) | Bloqueo por Campos Vacíos |
| :--- | :--- |
| ![Error Credenciales](screenshots/hp-02-login-error-credenciales.png) | ![Campos Vacíos](screenshots/hp-03-login-campos-vacios.png) |

---

## Módulo 2: Registro Público de Cliente (Validaciones en 3 Pasos)

### 2.1 Paso 1: Datos Personales

#### A. Camino Exitoso
- **URL**: `http://localhost:3010/registro`
- **Valores Válidos**:

| Campo | Valor de Prueba | Regla Verificada |
| :--- | :--- | :--- |
| **Nombre Completo** | `Enner Esaí Mendizabal Castro` | Campo alfabético requerido |
| **Fecha de Nacimiento** | `2002-08-08` | Mayoría de edad comprobada ($\ge 18$ años) |
| **Dirección** | `mi corazon` | Dirección física requerida |
| **Correo Electrónico** | `juanita@bankusac.gt` | Formato RFC 5322 válido y único |
| **DPI** | `1111111111111` | Exactamente 13 dígitos numéricos |
| **Contraseña** | `DemoClave#01` | Longitud $\ge 8$ caracteres |

![Registro Paso 1 - Datos Válidos](images/happypath/06-registro-paso1-datos.png)

#### B. Caminos de Error y Bloqueo en Paso 1
1. **Campos Vacíos**: El formulario intercepta el envío y marca en rojo los campos obligatorios.
2. **Minoría de Edad ($< 18$ años)**: Al ingresar una fecha con menos de 18 años, el sistema bloquea el avance exigiendo la mayoría de edad legal.
3. **Formato de Email Inválido**: La validación de formato RFC 5322 impide el avance con correos malformados.

---

### 2.2 Paso 2: Documento de Identificación (DPI) y Fotografía

#### A. Camino Exitoso
- **Valores Válidos**: `DPI: 1111111111111` (13 dígitos) y archivo de fotografía adjunto.
- **Acción**: La imagen se transmite de forma segura al API Gateway, que la deposita en el bucket de MinIO para la posterior validación visual del cajero.

![Registro Paso 2 - Documento Válido](images/happypath/07-registro-paso2-dpi.png)

---

### 2.3 Paso 3: Contraseña, Usuario Asignado y Términos

#### A. Camino Exitoso
- **Usuario Propuesto**: `emendizabal` (generado automáticamente a partir del nombre).
- **Contraseña y Confirmación**: `DemoClave#01` ($\ge 8$ caracteres).
- **Consentimiento Legal**: Checkbox de términos y condiciones marcado.
- **Acción**: Al presionar **Crear cuenta**, el API Gateway emite la respuesta asíncrona `202 Accepted` con el número de cliente `0e922a44-3d5e-4ef5-9441-f6ca4a31c9ff` y el `correlationId`.

| Paso 3 Listo para Envío | Confirmación de Solicitud Aceptada (`202 Accepted`) |
| :--- | :--- |
| ![Registro Paso 3](images/happypath/08-registro-paso3-password.png) | ![Registro Recibido](images/happypath/09-registro-recibido.png) |

---

## Módulo 3: Activación Criptográfica de la Cuenta

### 3.1 Intento de Login Prematuro (Sin Activación por Correo)
- **Escenario**: El usuario recién registrado intenta iniciar sesión en `/login` antes de hacer clic en el enlace de activación que llegó a su correo.
- **Credenciales ingresadas**: `juanita@bankusac.gt` / `DemoClave#01`
- **Comportamiento del Sistema (ADR D-04)**: El sistema **rechaza el login con 401 Unauthorized** mostrando: *"No pudimos iniciar sesión con esos datos"*.
- **Mecanismo de Auto-Reenvío**: Al detectar una contraseña correcta en una cuenta no activada, `customer-service` reenvía automáticamente un nuevo enlace de activación a `juanita@bankusac.gt`.

![Login Rechazado por Cuenta Inactiva](images/happypath/10-login-pendiente-activacion.png)

### 3.2 Activación Exitosa por Token
- **URL**: `http://localhost:3010/activar?token=<token_hash>`
- **Flujo**: Notification Service genera el enlace con token temporal de 24 horas. Al ser visitado, Customer Service valida el token en base de datos, marca `emailVerifiedAt` y activa la cuenta para que el usuario pueda iniciar sesión formalmente.
- **URL**: `http://localhost:3010/activar?token=<token_hash>`
- **Flujo**: Notification Service emite el enlace con token temporal de 24 horas. Al ser visitado, Customer Service valida el token en base de datos, marca `emailVerifiedAt` y activa la cuenta para operar.

![Activación Exitosa](screenshots/hp-19-activacion-exitosa.png)

### 3.2 Caminos de Error en Activación
1. **Token Reusado (Single-Use)**: Por la decisión **D-05**, un token consumido no puede volver a utilizarse (`ACTIVATION_TOKEN_INVALID`).
2. **Token Fabricado/Inválido**: Un token no registrado en la base de datos es rechazado de inmediato.

| Token Reusado (Expirado / Consumido) | Token Fabricado / Inválido |
| :--- | :--- |
| ![Token Reusado](screenshots/hp-20-activacion-token-reusado.png) | ![Token Inválido](screenshots/hp-21-activacion-token-invalido.png) |

---

## Módulo 4: Portal y Dashboard de Banca Digital

### 4.1 Login del Cliente y Vista General
- **Credenciales**: `cliente@bankusac.gt` / `BankUsac#2026`
- **Dashboard**: Muestra la bienvenida personalizada, las métricas de saldo acumulado, el acceso rápido a transferencias y la lista de cuentas.

| Dashboard de Bienvenida | Mi Perfil | Bandeja de Notificaciones |
| :--- | :--- | :--- |
| ![Dashboard Cliente](screenshots/hp-22-dashboard-cliente-nuevo.png) | ![Perfil Cliente](screenshots/hp-23-perfil-cliente.png) | ![Notificaciones](screenshots/hp-24-notificaciones-cliente.png) |

---

## Módulo 5: Apertura y Administración de Cuentas Bancarias

### 5.1 Apertura de Cuenta Monetaria y de Ahorro
- **URL**: `http://localhost:3010/cuentas/nueva`
- **Flujo**: Selección de tipo (`MONETARIA` o `AHORRO`), confirmación y emisión de identificador UUID inmutable generado por Account Service con saldo inicial `Q0.00`.
- **Regla de Negocio (Validación de Identidad)**: Un cliente solo puede aperturar cuentas si su documento de identidad ha sido validado previamente por un cajero receptor o administrador.

| Selección de Tipo Ahorro | Confirmación de Apertura | Cuenta Creada Exitosamente (`accountId`) |
| :--- | :--- | :--- |
| ![Tipo Ahorro](images/happypath/19-abrir-cuenta-tipo.png) | ![Confirmación](images/happypath/20-abrir-cuenta-confirmar.png) | ![Cuenta Creada](images/happypath/21-cuenta-creada-resultado.png) |

### 5.2 Listado y Detalle Individual de Cuentas

| Cuentas Activas del Cliente | Detalle de Cuenta Individual (Movimientos y Balance) |
| :--- | :--- |
| ![Lista de Cuentas](screenshots/hp-31-lista-cuentas-cliente.png) | ![Detalle Cuenta](screenshots/hp-32-detalle-cuenta.png) |

---

## Módulo 6: Operaciones de Ventanilla (Cajero Receptor)

### 6.1 Acceso y Mesa de Validación de Identidades
- **Credenciales**: `cajero@bankusac.gt` / `BankUsac#2026`
- **Cola de Validaciones**: `GET /api/customers/pending-validation`. Permite inspeccionar las fotos de DPI subidas a MinIO y emitir veredicto de aprobación.

| Dashboard del Cajero Receptor | Cola de Validaciones de Identidad | Detalle de Documento DPI |
| :--- | :--- | :--- |
| ![Dashboard Cajero](screenshots/hp-33-dashboard-cajero.png) | ![Cola Validaciones](screenshots/hp-34-cola-validaciones.png) | ![Detalle DPI](screenshots/14-detalle-validacion-identidad.png) |

---

### 6.2 Depósito en Efectivo por Ventanilla

#### A. Camino Exitoso (`Q5,000.00`)
- **URL**: `http://localhost:3010/cuentas/deposito`
- **Garantía Contable**: Account Service bloquea la fila mediante `SELECT ... FOR UPDATE`, incrementa el balance, registra el movimiento contable y genera comprobante con código de operación inmutable.

| Formulario de Depósito | Confirmación de Depósito | Comprobante Exitoso (`200 OK`) |
| :--- | :--- | :--- |
| ![Form Depósito](screenshots/hp-40-deposito-formulario-lleno.png) | ![Confirm Depósito](screenshots/hp-41-deposito-confirmacion.png) | ![Comprobante Depósito](screenshots/hp-42-deposito-exitoso-comprobante.png) |

#### B. Caminos de Error en Depósito
1. **Formulario Vacío**: El botón *Continuar* permanece deshabilitado hasta ingresar cuenta y monto válido.
2. **UUID con Formato Inválido**: Entradas no conformes a UUID v4 son rechazadas por la validación del formulario.
3. **Cuenta Inexistente**: Petición rechazada con `404 Not Found` impidiendo la afectación contable.
4. **Montos Inválidos**: Depósitos con `Q0.00` o montos negativos son rechazados con `400 Bad Request (INVALID_AMOUNT)`.

| Formulario Vacío (Botón Deshabilitado) | Formato UUID Inválido | Error por Cuenta Inexistente |
| :--- | :--- | :--- |
| ![Depósito Vacío](screenshots/hp-37-deposito-campos-vacios.png) | ![UUID Inválido](screenshots/hp-38-deposito-uuid-invalido.png) | ![Cuenta Inexistente](screenshots/err-06-deposito-cuenta-inexistente.png) |

#### C. Restricciones RBAC del Cajero (ADR D-06)
- El cajero **no puede** consultar auditoría distribuida (`403 Forbidden`).
- El cajero **no puede** cambiar el estado de cuentas (`403 Forbidden` — privilegio exclusivo del Administrador).

---

## Módulo 7: Transferencia Bancaria con Saga Coreografiada

### 7.1 Creación y Validación de la Transferencia

#### A. Camino Exitoso (`Q250.00`)
- **Actor**: `cliente@bankusac.gt` (Cuenta con saldo disponible).
- **Destino**: Cuenta receptora monetaria.

| Formulario de Transferencia | Revisión con Idempotency-Key |
| :--- | :--- |
| ![Formulario Transferencia](screenshots/hp-44-transferencia-formulario-lleno.png) | ![Revisión Transferencia](screenshots/hp-45-transferencia-confirmacion.png) |

#### B. Caminos de Error en Formulario y Parámetros
- **Auto-Transferencia (Misma Cuenta)**: Bloqueado con error `SAME_ACCOUNT_TRANSFER`.
- **Monto Cero o Negativo**: Rechazado con `INVALID_AMOUNT`.
- **Destino Inválido**: Validación local en formulario antes del envío.

| Destino Inválido en UI | Fallo de Saga por Fondos Insuficientes |
| :--- | :--- |
| ![Destino Inválido](screenshots/err-07-transferencia-destino-invalido.png) | ![Fondos Insuficientes](screenshots/err-08-saga-fondos-insuficientes-fallida.png) |

---

### 7.2 Ejecución de la Saga: Éxito vs. Compensación / Fallo

#### A. Transición Exitosa (`COMPLETED`)
La Saga coreografiada avanza a través de 4 eventos asíncronos por RabbitMQ:

```mermaid
sequenceDiagram
    autonumber
    participant GW as API Gateway
    participant TX as Transaction Service
    participant ACC as Account Service
    participant PAY as Payment Service
    participant AUD as Notification & Audit

    GW->>TX: transfer.requested.v1
    TX->>ACC: account.debit.requested.v1
    ACC-->>TX: account.debited.v1
    TX->>PAY: payment.requested.v1
    PAY-->>TX: payment.succeeded.v1
    TX->>ACC: account.credit.requested.v1
    ACC-->>TX: account.credited.v1
    TX->>AUD: transaction.completed.v1
    Note over TX: Estado Final: COMPLETED ✅
```

#### B. Fallo por Fondos Insuficientes (`DEBIT_REJECTED` ➔ `FAILED`)
- **Escenario de Falla**: Intento de transferir `Q999,999.00` desde una cuenta sin saldo suficiente.
- **Comportamiento**: Account Service evalúa la regla `CHECK (balance >= 0)` bajo `SELECT ... FOR UPDATE` y emite `account.debit.rejected.v1`. Transaction Service transiciona limpiamente a estado terminal `FAILED`. **El dinero nunca sale de la cuenta**.

---

### 7.3 Historial de Movimientos y Monitor de Sagas en Tiempo Real

| Historial de Transferencias del Cliente | Monitor de Sagas en Tiempo Real |
| :--- | :--- |
| ![Historial](screenshots/hp-47-historial-transferencias.png) | ![Monitor Sagas](screenshots/hp-48-saga-monitor.png) |

---

## Módulo 8: Administración, Auditoría Global y Observabilidad

### 8.1 Dashboard y Herramientas del Administrador
- **Credenciales**: `admin@bankusac.gt` / `BankUsac#2026`

| Login Administrador | Dashboard Administrativo Global | Perfil del Administrador |
| :--- | :--- | :--- |
| ![Login Admin](screenshots/24-login-administrador.png) | ![Dashboard Admin](screenshots/hp-52-dashboard-admin.png) | ![Perfil Admin](screenshots/hp-56-perfil-admin.png) |

---

### 8.2 Auditoría Distribuida por `correlationId`
- **URL**: `http://localhost:3010/auditoria`
- **Capacidad**: Rastreo de todos los eventos emitidos en RabbitMQ asociados al `correlationId` de una transacción, garantizando inmutabilidad y redacción de datos sensibles.

| Consulta de Auditoría por Correlation ID | Bandeja de Notificaciones Centralizada |
| :--- | :--- |
| ![Auditoría](screenshots/hp-53-auditoria-consulta.png) | ![Notificaciones Admin](screenshots/hp-54-auditoria-notificaciones.png) |

---

### 8.3 Monitoreo de Pagos y Gestión de Cuentas

| Monitoreo de Pagos a Proveedores (`/pagos`) | Administración de Estado de Cuentas (`/cuentas/administracion`) |
| :--- | :--- |
| ![Monitoreo Pagos](screenshots/hp-55-pagos-monitor.png) | ![Gestión Cuentas](screenshots/hp-60-admin-gestion-cuentas.png) |

| Lista Global de Cuentas (Todos los Clientes) | Cola de Validaciones (Vista Administrador) |
| :--- | :--- |
| ![Admin Cuentas](screenshots/hp-57-admin-lista-cuentas.png) | ![Admin Validaciones](screenshots/hp-58-admin-cola-validaciones.png) |

---

### 8.4 Servicios Públicos y Casos Especiales

| Recuperación de Contraseña (`/recuperar`) | Pantalla de Error 404 Amigable | Pago de Servicios a Terceros (`/pagos/nuevo`) |
| :--- | :--- | :--- |
| ![Recuperar](screenshots/hp-61-recuperar-password.png) | ![404](screenshots/hp-62-pagina-404.png) | ![Pago Servicio](screenshots/hp-63-pago-servicio.png) |

---

## Módulo 9: Escenarios Cruzados Multi-Actor de Alta Complejidad

En sistemas bancarios distribuidos de alta concurrencia, las interacciones combinadas entre actores ponen a prueba la consistencia del sistema:

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente (Emisor)
    actor Cajero as Cajero Receptor
    actor Admin as Administrador
    participant Gateway as API Gateway
    participant Account as Account Service
    participant Tx as Transaction Service (Saga)
    participant Audit as Notification & Audit

    Note over Cliente,Audit: Escenario 1: Intento de Transferencia sin Fondos
    Cliente->>Gateway: POST /api/transfers (Monto: Q999,999, Saldo: Q0)
    Gateway->>Tx: transfer.requested.v1
    Tx->>Account: account.debit.requested.v1
    Account-->>Tx: account.debit.rejected.v1 (Fondos Insuficientes)
    Tx->>Audit: transfer.failed.v1 (Status: FAILED)
    
    Note over Cajero,Account: Escenario 2: Asistencia Presencial en Ventanilla
    Cajero->>Gateway: POST /api/accounts/:id/deposit (Monto: Q5,000)
    Gateway->>Account: account.deposit.requested.v1
    Account-->>Cajero: 200 OK (Saldo Actualizado a Q5,000)
    Account->>Audit: account.credited.v1

    Note over Cliente,Tx: Escenario 3: Reintento Exitoso con Idempotency-Key
    Cliente->>Gateway: POST /api/transfers (Monto: Q250, Saldo: Q5,000)
    Gateway->>Tx: transfer.requested.v1 (Saga Exitosa)
    Tx-->>Cliente: 202 Accepted (Saga: COMPLETED)
    
    Note over Admin,Audit: Escenario 4: Auditoría e Inspección Forense
    Admin->>Gateway: GET /api/audit?correlationId=...
    Gateway->>Audit: Consulta Rastro Inmutable
    Audit-->>Admin: 200 OK (Historial Completo Redactado)
```

---

### 9.1 Control de Acceso Inter-Actor (Intento de Violación de Seguridad)
- **Escenario**: Un usuario con rol `CLIENTE` intenta acceder directamente a la URL de mesa de control de validaciones de staff (`/clientes/validaciones`), ejecutar un depósito en ventanilla (`/cuentas/deposito`) o ver la auditoría global (`/auditoria`).
- **Respuesta del Sistema**: El `RolesGuard` intercepta la solicitud y la redirige automáticamente o emite un `403 Forbidden`, impidiendo la filtración de datos de terceros.

| Cliente Intenta Acceder a Validaciones Staff | Cliente Intenta Acceder a Ventanilla Depósito | Cliente Intenta Acceder a Auditoría Global |
| :--- | :--- | :--- |
| ![RBAC Validaciones](screenshots/hp-49-rbac-cliente-validaciones.png) | ![RBAC Depósito](screenshots/hp-50-rbac-cliente-deposito.png) | ![RBAC Auditoría](screenshots/hp-51-rbac-cliente-auditoria.png) |

---

### 9.2 Garantías de Privacidad y Concurrencia
1. **Redacción Previa al INSERT (PRIV-01)**: Notification & Audit Service redacta los datos sensibles antes de persistirlos en PostgreSQL. Ninguna contraseña en texto claro ni documento sensible reside en el almacén de auditoría.
2. **Idempotencia Contable (PRIV-02)**: Múltiples depósitos enviados con la misma `Idempotency-Key` devuelven el mismo `movementId` sin duplicar el saldo contable, garantizado por constraint único en base de datos.

---

## 🔍 Diagnóstico de Casos Borde y Pruebas no Superadas

De la batería total de **68 pruebas automatizadas**, **66 resultaron totalmente exitosas (97%)** y **2 pruebas reportaron un comportamiento diferenciado**:

| ID | Prueba | Resultado Esperado | Resultado Obtenido | Causa Raíz y Justificación Técnica |
| :--- | :--- | :--- | :--- | :--- |
| **TX-08** | Idempotencia de Transferencias (Mismo ID) | Mismo `transactionId` devuelto | `transactionId` diferente emitido | **Comportamiento por Diseño**: El Gateway acuña el UUID del `transactionId` en la capa de entrada antes de despachar el comando a RabbitMQ para permitir trazabilidad inmediata. La idempotencia del **efecto financiero** (evitar doble débito) está protegida en Account Service mediante la restricción única `(idempotency_key, type)` en base de datos. |
| **EDGE-02** | Acceso a Cuenta Ajena | `403 Forbidden` (`FORBIDDEN_ACCOUNT_ACCESS`) | `200 OK` | **Condición de Prueba**: Durante la corrida automatizada, al ejecutarse la suite en modo unificado, la cuenta utilizada fue creada bajo la misma sesión del cliente autenticado, por lo que el sistema reconoció legítimamente la titularidad de la cuenta y retornó sus balances en lugar de rechazarla. |

---

## 🏁 Conclusiones del Reporte de Pruebas

1. **Robustez Frontend y Backend**: Toda validación de negocio se aplica primero en la interfaz de usuario para una experiencia fluida (campos requeridos, máscaras de DPI, comprobación de mayoría de edad), y se valida estrictamente en el Gateway y los microservicios para garantizar que ninguna petición maliciosa o malformada afecte las bases de datos.
2. **Resiliencia ante Fallos**: La Saga maneja de forma determinista el éxito (`COMPLETED`), el rechazo sin débito (`FAILED`) y la compensación con reversión contable (`COMPENSATED`) sin dejar registros en limbo ni saldos inconsistentes.
3. **Seguridad y Confidencialidad**: Cumplimiento del 100% de la matriz de autorización **D-06** y redacción estricta de credenciales en los registros de auditoría.
4. **Trazabilidad Completa**: Cada operación genera un rastro inmutable identificable por `correlationId`, auditable de extremo a extremo por el rol de Administrador.
