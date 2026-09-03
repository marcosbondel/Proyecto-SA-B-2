# Manual de Usuario — Bank USAC

Bienvenido al manual de usuario de **Bank USAC**. Esta guía detalla la operación de la plataforma bancaria web para cada uno de los tres roles del sistema: **Cliente**, **Cajero Receptor** y **Administrador**.

---

## 1. Acceso y Navegación General

* **URL de Acceso Local**: `http://localhost:3010/`
* **Punto de Entrada API Gateway**: `http://localhost:3000/`
* **Credenciales Demo Rápidas**:
  * **Cliente Principal (Marco Tulio López)**: `marco.lopez@bankusac.gt` / `BankUsac#2026`
  * **Cliente Tercero (Clara Cliente)**: `cliente@bankusac.gt` / `BankUsac#2026`
  * **Cajero Receptor**: `cajero@bankusac.gt` / `BankUsac#2026`
  * **Administrador**: `admin@bankusac.gt` / `BankUsac#2026`

---

## 2. Rol: Cliente (`CLIENTE`)

El cliente opera desde la comodidad de su dispositivo personal para gestionar sus finanzas.

### A. Registro y Activación
1. En la página de inicio, haga clic en **"Registrarse"** (`/registro`).
2. Ingrese sus datos personales: Nombre completo, DPI (13 dígitos), Fecha de nacimiento, Dirección y Correo electrónico.
3. Cargue la fotografía clara de su documento de identificación (DPI).
4. El sistema enviará un correo de confirmación. Abra el enlace de activación para activar su cuenta.

### B. Consulta de Cuentas y Saldos
* Desde el **Inicio**, visualice sus cuentas monetarias y de ahorro activas con sus saldos actualizados en Quetzales.
* Haga clic en una cuenta para ver el historial detallado de movimientos contables (`/cuentas/[id]`).

### C. Transferencias entre Cuentas
1. Ingrese a **Transferencias** (`/transferencias`).
2. Seleccione su cuenta de origen y especifique la cuenta de destino (propia o de terceros).
3. Ingrese el monto en Quetzales y confirme la operación.
4. El sistema procesa la transferencia en tiempo real con confirmación visual de la Saga y comprobante descargable.

### D. Pago de Servicios
1. Diríjase a **Pagos** (`/pagos`).
2. Seleccione el facturador (por ejemplo, Agua, Electricidad, Telefonía).
3. Ingrese el número de referencia de la factura y seleccione la cuenta a debitar.
4. Confirme el pago para obtener su comprobante digital.

### E. Buzón de Notificaciones
* Acceda al icono de campana en la barra superior (`/notificaciones`) para consultar alertas de débitos, créditos y avisos de seguridad, con opción de marcarlas como leídas.

---

## 3. Rol: Cajero Receptor (`CAJERO_RECEPTOR`)

El cajero receptor atiende al público en las agencias bancarias y realiza operaciones presenciales.

### A. Mesa de Control de Identidad (Validaciones)
1. Ingrese a **Validaciones** (`/clientes/validaciones`).
2. Revise la lista de clientes con documentos DPI pendientes de validación.
3. Inspeccione la fotografía subida y coteje los datos ingresados contra la imagen.
4. Haga clic en **Aprobar** para habilitar al cliente para aperturar cuentas, o **Rechazar** indicando el motivo.

### B. Apertura de Cuentas Bancarias
1. Una vez validada la identidad del cliente, ingrese a **Cuentas → Abrir Cuenta** (`/cuentas/nueva`).
2. Ingrese el identificador o DPI del cliente verificado.
3. Seleccione el tipo de cuenta: **Monetaria** o **Ahorro**.
4. Confirme la apertura. La cuenta nace activa con saldo inicial de `Q 0.00`.

### C. Depósito en Efectivo por Ventanilla
1. Ingrese a **Cuentas → Depósito** (`/cuentas/deposito`).
2. Ingrese el número de cuenta de destino del cliente.
3. Ingrese el monto en efectivo recibido en ventanilla.
4. Haga clic en **Registrar Depósito**. El sistema acredita el saldo de inmediato (`200 OK`) y emite el comprobante de depósito.
5. *Nota:* Si la cuenta del cliente se encontraba inactiva por falta de uso, el depósito la reactiva automáticamente.

---

## 4. Rol: Administrador (`ADMINISTRADOR`)

El administrador supervisa la seguridad, auditoría e infraestructura del banco.

### A. Auditoría Transversal del Sistema
1. Ingrese a **Auditoría** (`/auditoria`).
2. Filtre los eventos del sistema por código de trazabilidad (`correlationId`), rango de fechas, microservicio emisor o tipo de mensaje.
3. Inspeccione los payloads redactados para verificar el cumplimiento normativo sin exponer contraseñas ni datos confidenciales.

### B. Gestión y Estado de Cuentas
1. Ingrese a **Cuentas → Administración** (`/cuentas/administracion`).
2. Permite activar o desactivar manualmente cuentas bancarias ante bloqueos judiciales o solicitudes del titular.

### C. Monitor de la Saga y Flujos Distribuidos
* Inspeccione transferencias en curso, tiempos de respuesta de los microservicios y transiciones de la máquina de estados.

---

Para guías específicas por pantalla y capturas paso a paso, consulte el [Directorio Detallado de Manuales](manual/README.md).
