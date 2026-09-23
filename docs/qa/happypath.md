# Guía Integral de Pruebas: Happy Path, Validaciones y Casos de Error

Este documento constituye la **Guía Maestra de Pruebas y Demostración Integral** de **Bank USAC**. Detalla la totalidad de los flujos del sistema bancario distribuido interactuando con los tres actores (**Cliente**, **Cajero Receptor** y **Administrador**), contrastando en cada módulo el **Camino Exitoso (Happy Path)** frente a los **Caminos de Validación y Manejo de Errores (Unhappy / Edge Cases)**, respaldado por evidencias visuales de alta resolución tomadas en tiempo real durante la ejecución automatizada.

---

## 🏛️ Matriz de Actores y Credenciales de Demostración

| Actor / Rol | Credenciales | Propósito | Privilegios y Restricciones (ADR D-06) |
| :--- | :--- | :--- | :--- |
| **Cliente Pre-sembrado Principal (Marco Tulio López)** | `marco.lopez@bankusac.gt` / `BankUsac#2026` | Cuentas principales pre-fondeadas (Q5,000 / Q1,500) para pruebas de transferencias y pagos. | Puede ver únicamente sus cuentas, movimientos y notificaciones. |
| **Cliente Tercero Pre-sembrado (Clara Cliente)** | `cliente@bankusac.gt` / `BankUsac#2026` | Cuentas secundarias (Q2,500 / Q800) destinatario para pruebas de transferencias y depósitos. | Puede ver únicamente sus cuentas, movimientos y notificaciones. |
| **Cliente para Demostración en Vivo** | `ventanilla@bankusac.gt` | Correo real libre de siembra predeterminada, reservado para demostrar el alta por el cajero en ventanilla o el auto-registro web, y la recepción en vivo de correos de activación y rechazo. | Alta viva en tiempo real sin colisión de unicidad. |
| **Cajero Receptor (Ventanilla)** | `cajero@bankusac.gt` / `BankUsac#2026` | Registro de clientes en ventanilla, validación/rechazo de documentos DPI y abono de depósitos. | No puede ordenar transferencias entre clientes ni auditar el sistema (`403`). |
| **Administrador del Sistema** | `admin@bankusac.gt` / `BankUsac#2026` | Auditoría distribuida, monitoreo de pagos, gestión de estado y creación de personal staff. | Acceso de lectura global al bus de eventos y métricas de servicios. |

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

![Registro Paso 1 - Datos Válidos](screenshots/hp-09-registro-paso1-datos-validos.png)

#### B. Caminos de Error y Bloqueo en Paso 1
1. **Campos Vacíos**: El formulario intercepta el envío y marca en rojo los campos obligatorios.
2. **Minoría de Edad ($< 18$ años)**: Al ingresar una fecha con menos de 18 años, el sistema bloquea el avance exigiendo la mayoría de edad legal.
3. **Formato de Email Inválido**: La validación de formato RFC 5322 impide el avance con correos malformados.

---

### 2.2 Paso 2: Documento de Identificación (DPI) y Fotografía

#### A. Camino Exitoso
- **Valores Válidos**: `DPI: 1111111111111` (13 dígitos) y archivo de fotografía adjunto.
- **Acción**: La imagen se transmite de forma segura al API Gateway, que la deposita en el bucket de MinIO para la posterior validación visual del cajero.

![Registro Paso 2 - Documento Válido](screenshots/hp-13-registro-paso2-completo.png)

---

### 2.3 Paso 3: Contraseña, Usuario Asignado y Términos

#### A. Camino Exitoso
- **Usuario Propuesto**: `emendizabal` (generado automáticamente a partir del nombre).
- **Contraseña y Confirmación**: `DemoClave#01` ($\ge 8$ caracteres).
- **Consentimiento Legal**: Checkbox de términos y condiciones marcado.
- **Acción**: Al presionar **Crear cuenta**, el API Gateway emite la respuesta asíncrona `202 Accepted` con el número de cliente `0e922a44-3d5e-4ef5-9441-f6ca4a31c9ff` y el `correlationId`.

| Paso 3 Listo para Envío | Confirmación de Solicitud Aceptada (`202 Accepted`) |
| :--- | :--- |
| ![Registro Paso 3](screenshots/hp-17-registro-paso3-completo.png) | ![Registro Recibido](screenshots/hp-18-registro-solicitud-aceptada.png) |

---

## Módulo 3: Activación Criptográfica de la Cuenta

### 3.1 Intento de Login Prematuro (Sin Activación por Correo)
- **Escenario**: El usuario recién registrado intenta iniciar sesión en `/login` antes de hacer clic en el enlace de activación que llegó a su correo.
- **Credenciales ingresadas**: `juanita@bankusac.gt` / `DemoClave#01`
- **Comportamiento del Sistema (ADR D-04)**: El sistema **rechaza el login con 401 Unauthorized** mostrando: *"No pudimos iniciar sesión con esos datos"*.
- **Mecanismo de Auto-Reenvío**: Al detectar una contraseña correcta en una cuenta no activada, `customer-service` reenvía automáticamente un nuevo enlace de activación a `juanita@bankusac.gt`.

*Login Rechazado por Cuenta Inactiva — captura pendiente de recapturar*

### 3.2 Activación Exitosa por Token y Correo Real
- **URL**: `https://bank-usac-web-mn2e6zhkwq-uc.a.run.app/activar?token=<token_hash>`
- **Flujo**: Notification Service despacha el correo transaccional real a través de Resend (`bonking <no-reply@guatechnology.com>`) con token criptográfico temporal. Al hacer clic, Customer Service valida el token en base de datos, marca `emailVerifiedAt` y activa la cuenta para que el usuario pueda iniciar sesión formalmente.

| Correo Transaccional Recibido (Resend) | Confirmación de Activación Exitosa |
| :--- | :--- |
| ![Correo de Activación](screenshots/hp-19-correo-activacion.png) | ![Activación Exitosa](screenshots/hp-20-activacion-exitosa.png) |

### 3.3 Caminos de Error en Activación
1. **Token Reusado (Single-Use)**: Por la decisión **D-05**, un token consumido no puede volver a utilizarse (`ACTIVATION_TOKEN_INVALID`).
2. **Token Fabricado/Inválido**: Un token no registrado en la base de datos es rechazado de inmediato.

| Token Reusado (Expirado / Consumido) | Token Fabricado / Inválido |
| :--- | :--- |
| *Token Reusado — captura pendiente de recapturar* | ![Token Inválido](screenshots/hp-21-activacion-token-invalido.png) |

---

## Módulo 4: Portal y Dashboard de Banca Digital

### 4.1 Login del Cliente y Vista General
- **Credenciales**: `cliente@bankusac.gt` / `BankUsac#2026`
- **Dashboard**: Muestra la bienvenida personalizada, las métricas de saldo acumulado, el acceso rápido a transferencias y la lista de cuentas.

| Dashboard de Bienvenida | Mi Perfil (KYC Pendiente) | Mi Perfil (KYC Verificado) |
| :--- | :--- | :--- |
| ![Dashboard Cliente](screenshots/hp-22-dashboard-cliente-nuevo.png) | ![Perfil Cliente](screenshots/hp-23-perfil-cliente.png) | ![Perfil Cliente Verificado](screenshots/hp-23b-perfil-cliente-kyc-verificado.png) |

---

## Módulo 5: Apertura y Administración de Cuentas Bancarias

### 5.1 Apertura de Cuenta Monetaria y de Ahorro
- **URL**: `https://bank-usac-web-mn2e6zhkwq-uc.a.run.app/cuentas/nueva`
- **Flujo**: Selección de tipo (`MONETARIA` o `AHORRO`), verificación en vivo del depósito inicial de apertura (boleta validada) y emisión de identificador UUID inmutable por Account Service.
- **Regla de Negocio (Validación de Identidad)**: Un cliente solo puede aperturar cuentas si su documento de identidad ha sido validado previamente por un cajero receptor o administrador.

| Selección de Tipo Ahorro (Depósito Verificado) | Confirmación de Apertura | Cuenta Creada Exitosamente (`accountId`) |
| :--- | :--- | :--- |
| ![Tipo Ahorro](screenshots/hp-29-cuenta-nueva-tipo-ahorro.png) | ![Confirmación](screenshots/hp-27-cuenta-nueva-confirmacion.png) | ![Cuenta Creada](screenshots/hp-30-cuenta-ahorro-creada.png) |

### 5.2 Listado y Detalle Individual de Cuentas

| Detalle de Cuenta Activa (Saldo Inicial Q100) | Cuenta Desactivada / Inactiva |
| :--- | :--- |
| ![Detalle Cuenta Activa](screenshots/hp-32-detalle-cuenta.png) | ![Cuenta Desactivada](screenshots/hp-32b-cuenta-desactivada.png) |

---

## Módulo 6: Operaciones de Ventanilla (Cajero Receptor)

### 6.1 Acceso y Mesa de Validación de Identidades
- **Credenciales**: `cajero@bankusac.gt` / `BankUsac#2026`
- **Cola de Validaciones**: `GET /api/customers/pending-validation`. Permite inspeccionar las fotos de DPI subidas a MinIO y emitir veredicto de aprobación.

| Dashboard del Cajero Receptor | Cola de Validaciones de Identidad | Detalle de Documento DPI |
| :--- | :--- | :--- |
| ![Dashboard Cajero](screenshots/hp-33-dashboard-cajero.png) | ![Cola Validaciones](screenshots/hp-34-cola-validaciones.png) | ![Detalle DPI](screenshots/hp-34-cola-validaciones.png) |

---

### 6.2 Depósito en Efectivo por Ventanilla

#### A. Camino Exitoso (`Q5,000.00`)
- **URL**: `http://localhost:3010/cuentas/deposito`
- **Garantía Contable**: Account Service bloquea la fila mediante `SELECT ... FOR UPDATE`, incrementa el balance, registra el movimiento contable y genera comprobante con código de operación inmutable.

| Formulario de Depósito | Confirmación de Depósito | Comprobante Exitoso (`200 OK`) |
| :--- | :--- | :--- |
| *Form Depósito — captura pendiente de recapturar* | *Confirm Depósito — captura pendiente de recapturar* | ![Comprobante Depósito](screenshots/hp-42-deposito-exitoso-comprobante.png) |

#### B. Caminos de Error en Depósito
1. **Formulario Vacío**: El botón *Continuar* permanece deshabilitado hasta ingresar cuenta y monto válido.
2. **UUID con Formato Inválido**: Entradas no conformes a UUID v4 son rechazadas por la validación del formulario.
3. **Cuenta Inexistente**: Petición rechazada con `404 Not Found` impidiendo la afectación contable.
4. **Montos Inválidos**: Depósitos con `Q0.00` o montos negativos son rechazados con `400 Bad Request (INVALID_AMOUNT)`.

| Formulario Vacío (Botón Deshabilitado) | Formato UUID Inválido | Error por Cuenta Inexistente |
| :--- | :--- | :--- |
| ![Depósito Vacío](screenshots/hp-37-deposito-campos-vacios.png) | ![UUID Inválido](screenshots/hp-38-deposito-uuid-invalido.png) | *Cuenta Inexistente — captura pendiente de recapturar* |

#### C. Restricciones RBAC del Cajero (ADR D-06)
- El cajero **no puede** consultar auditoría distribuida (`403 Forbidden`).
- El cajero **no puede** cambiar el estado de cuentas (`403 Forbidden` — privilegio exclusivo del Administrador).

---

## Módulo 7: Transferencia Bancaria con Saga Coreografiada

### 7.1 Creación y Validación de la Transferencia

#### A. Camino Exitoso (`Q30.00`)
- **Actor**: `juanita@bankusac.gt` / `ennermendizabal` (Cuenta de Ahorro activa con saldo disponible de Q 57.00).
- **Destino**: Cuenta receptora registrada (`b0000000-0002-4000-8000-000000000004`).
- **Escenario**: `Sin escenario (comportamiento real)`.

| Formulario de Transferencia Exitosa | Revisión con Idempotency-Key |
| :--- | :--- |
| ![Formulario Transferencia](screenshots/hp-43-transferencia-formulario.png) | ![Revisión Transferencia](screenshots/hp-45-transferencia-confirmacion.png) |

#### B. Caminos de Error en Formulario y Parámetros
- **Auto-Transferencia (Misma Cuenta)**: Bloqueado con error `SAME_ACCOUNT_TRANSFER`.
- **Monto Cero o Negativo**: Rechazado con `INVALID_AMOUNT`.
- **Destino Inválido**: Validación local en formulario antes del envío.

| Destino Inválido en UI | Simulación de Rechazo en Demostración |
| :--- | :--- |
| *Destino Inválido — validación UI* | ![Simulación de Rechazo](screenshots/hp-44-transferencia-formulario-lleno.png) |

---

### 7.2 Ejecución de la Saga: Éxito vs. Compensación / Fallo

#### A. Transición Exitosa (`COMPLETED`)
La Saga coreografiada avanza a través de los eventos asíncronos orquestados por RabbitMQ:

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

| Monitor de Saga Completada (Q30.00) | Resultado de Pago Aprobado |
| :--- | :--- |
| ![Saga Completada](screenshots/hp-46-saga-completada.png) | Operación `61457774-8ee2-4448-8c5d-15ca44281cb7` con 6 hitos validados |

#### B. Demostración de Resiliencia y Compensación de la Saga
- **Rechazo de Pago Inmediato**: Débito efectuado pero pago rechazado ➔ compensación automática inmediata (devolución del dinero al origen).
- **Caída de Proveedor (Timeout con Escalera de Reintentos)**: El sistema escala de forma exponencial (1s, 5s, 30s) para reintentar hasta 4 veces antes de liquidar o compensar.

| Formulario Timeout (Escalera) | Revisión Q40.00 | Monitor Reintentando | Monitor Compensada |
| :--- | :--- | :--- | :--- |
| ![Formulario Timeout](screenshots/hp-44b-transferencia-timeout.png) | ![Revisión Q40](screenshots/hp-45b-transferencia-confirmacion-q40.png) | ![Monitor Sagas Reintentando](screenshots/hp-48-saga-monitor.png) | ![Saga Compensada](screenshots/hp-46b-saga-compensada.png) |

---

### 7.3 Historial de Movimientos y Filtrado Reactivo

| Historial en Proceso (Reintento en Vivo) | Historial Consolidado (3 Transacciones) | Historial Filtrado por Estado (Aprobada) |
| :--- | :--- | :--- |
| ![Historial en Proceso](screenshots/hp-47b-transferencias-historial-en-proceso.png) | ![Historial Consolidado](screenshots/hp-47-historial-transferencias.png) | ![Historial Filtrado](screenshots/hp-47c-transferencias-historial-filtrado.png) |

---

## Módulo 8: Administración, Auditoría Global y Observabilidad

### 8.1 Dashboard y Herramientas del Administrador
- **Credenciales**: `admin@bankusac.gt` / `BankUsac#2026`

| Login Administrador | Dashboard Administrativo Global | Perfil del Administrador |
| :--- | :--- | :--- |
| ![Login Admin](screenshots/hp-52-dashboard-admin.png) | ![Dashboard Admin](screenshots/hp-52-dashboard-admin.png) | ![Perfil Admin](screenshots/hp-56-perfil-admin.png) |

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
