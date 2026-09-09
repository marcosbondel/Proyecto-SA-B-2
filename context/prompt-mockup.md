PROMPT MAESTRO — PROTOTIPO FRONTEND "BANK USAC" (Google Stitch)
================================================================

1. CONTEXTO DEL PRODUCTO
------------------------
Diseña el prototipo completo de "Bank USAC", la interfaz web de un sistema
bancario distribuido basado en 5 microservicios (Customer, Account,
Transaction, Payment, Notification & Audit) que se comunican de forma
asíncrona mediante eventos (RabbitMQ) y Sagas por coreografía. El frontend es
una aplicación web (desktop-first, responsive) cuyo propósito es validar las
funcionalidades de cada microservicio.

El sistema tiene 3 roles de usuario:
- CLIENTE (cuentahabiente): se registra, valida su identidad, administra sus
  cuentas, transfiere, paga y revisa su actividad.
- CAJERO RECEPTOR: valida identidades, crea cuentas para clientes y registra
  depósitos en ventanilla.
- ADMINISTRADOR: supervisa clientes, cuentas, transacciones, pagos y la
  auditoría global del sistema.

Existen 2 tipos de cuenta bancaria: MONETARIA y DE AHORRO.

2. SISTEMA DE DISEÑO (OBLIGATORIO)
----------------------------------
Junto con este prompt se adjunta el archivo DESIGN.md, que es la fuente de
verdad visual e interactiva. Síguelo ESTRICTAMENTE:
- Paleta: primario verde #8CE071 con contraste oscuro #1A201D, superficies
  blancas #FFFFFF y muted #F7F9F8, bordes #E5E7EB, texto #111827 / #6B7280,
  semánticos: éxito #2F9E44, advertencia #F59E0B, error #EF4444,
  info #6366F1. No inventes otros colores.
- Tipografía Inter (400/500/600/700); números hero de 48px para saldos;
  montos e identificadores con cifras tabulares alineadas.
- Grid de 8px; tarjetas blancas con radio 16–24px y sombra sutil O borde 1px
  (nunca ambos fuertes); botones con radio 8–12px.
- Layout: rail de navegación lateral izquierdo fijo + header superior
  (búsqueda global, campana de notificaciones con badge, menú de perfil) +
  área de contenido fluida con ancho máximo 1200px.
- Estética: banca moderna, limpia y serena; jerarquía clara; movimiento
  contenido; nada genérico tipo plantilla.

3. CONVENCIONES DE DOMINIO Y COPY
---------------------------------
- TODO el texto de la interfaz en ESPAÑOL (locale es-GT).
- Moneda: quetzales guatemaltecos con prefijo Q, separador de miles con coma
  y dos decimales: "Q 1,250.00". Negativos con signo antes del monto.
- Fechas en formato es-GT; cuando un timestamp representa un evento del
  sistema, incluir la zona horaria (ej. "14 ago 2026, 10:32:15 GMT-6").
- Identificadores (customerId, accountId, transactionId, paymentId, eventId,
  correlationId): respetar mayúsculas/minúsculas, NUNCA truncarlos, y
  ofrecer acción de copiar en los largos.
- Regla de oro del sistema: las operaciones son ASÍNCRONAS. "Pendiente" y
  "Completada" son estados VISUAL Y TEXTUALMENTE DISTINTOS. Una operación
  aceptada (HTTP 202) NO es una operación completada. Nunca ocultar un Saga
  pendiente detrás de un spinner genérico: mostrar estado, identificador de
  seguimiento y pasos del flujo.

4. ESTRUCTURA GLOBAL (SHELL)
----------------------------
- Sidebar izquierdo con logo "Bank USAC", navegación según rol activo, y
  estado de colapso en móvil.
- Header superior: buscador global, campana de notificaciones con contador,
  avatar con menú (Mi perfil, Cerrar sesión).
- Navegación CLIENTE: Inicio, Mis cuentas, Transferencias, Pagos,
  Notificaciones, Perfil.
- Navegación CAJERO: Inicio, Validaciones, Crear cuenta, Depósitos.
- Navegación ADMINISTRADOR: Inicio, Clientes, Cuentas, Transacciones, Pagos,
  Auditoría.








5. INVENTARIO DE PANTALLAS
--------------------------

### MÓDULO 0 — ACCESO PÚBLICO (Customer Service: identidad y autenticación)

P-01 · Login
Formulario centrado sobre fondo muted: usuario (username) y contraseña,
botón primario "Iniciar sesión", enlaces "Crear cuenta" y "¿Olvidaste tu
contraseña?". Estados: error de credenciales inválidas (alerta junto al
formulario), y aviso "Tu cuenta aún no está activa: revisa tu correo" cuando
el usuario no ha completado la activación.

P-02 · Registro de cliente — Paso 1: Datos personales
Wizard con indicador de 3 pasos. Campos: nombre completo, fecha de nacimiento
(date picker con validación de coherencia: fecha válida y mayoría de edad),
dirección, correo electrónico. Validación local por campo, mensaje junto al
campo, conserva lo ya escrito.

P-03 · Registro de cliente — Paso 2: Documento de identidad
Campo de número de documento (DPI) y zona de carga de la FOTO del documento
(mostrando formatos aceptados JPG/PNG, tamaño máximo, barra de progreso y
estado de error de carga). Vista previa de la imagen subida.

P-04 · Registro de cliente — Paso 3: Confirmación
Resumen de los datos ingresados y el documento; muestra el USERNAME generado
automáticamente a partir del nombre (campo de solo lectura); creación de
contraseña con confirmación; checkbox de términos; botón "Registrarme".

P-05 · Registro enviado / Revisa tu correo
Estado de éxito del registro: mensaje explicando que se envió un correo con
un enlace para ACTIVAR la cuenta (la cuenta queda activa al validarse el
enlace), botón "Reenviar correo" y enlace a Login.

P-06 · Activación de cuenta (landing del enlace de correo)
Dos variantes: (a) "Tu cuenta está activa" con CTA "Iniciar sesión";
(b) enlace expirado o inválido con opción de reenviar el correo de
activación.

P-07 · Recuperar contraseña
Campo de correo, estado de envío y confirmación.














### MÓDULO 1 — CUSTOMER SERVICE (clientes e identidad)

C-01 · Mi perfil (Cliente)
Datos personales: nombre completo y username de solo lectura; formulario de
actualización de correo y dirección; badge del estado de validación de
identidad ("Identidad verificada" / "En revisión" / "Rechazada" con motivo);
sección de cambio de contraseña. Estados: guardando (botón deshabilitado,
sin doble envío), guardado (toast + resumen), error de validación junto al
campo.

C-02 · Cola de validación de identidad (Cajero, también Admin)
Tabla de clientes pendientes de validación: nombre, username, documento,
fecha de registro, estado. Filtro por estado (pendiente/aprobado/rechazado)
y búsqueda por nombre o documento.

C-03 · Revisión de identidad — detalle (Cajero)
Vista dividida: a la izquierda el visor de la FOTO del documento de
identidad (con zoom); a la derecha los datos declarados (nombre, número de
documento, fecha de nacimiento, dirección). Acciones: "Aprobar identidad"
(primario) y "Rechazar" (destructivo, exige motivo en modal de
confirmación). Estado resultado con toast y regreso a la cola.








### MÓDULO 2 — ACCOUNT SERVICE (cuentas y saldos)

A-01 · Dashboard del cliente (Inicio)
Número hero con el saldo total consolidado en Q; grid de tarjetas de cuentas
(cada tarjeta: tipo Monetaria/Ahorro con icono, número de cuenta, saldo con
cifras tabulares, badge de estado); sección "Actividad reciente" (últimos
movimientos con monto con signo, fecha y badge de estado); accesos rápidos:
"Transferir" y "Pagar". Estado vacío: cliente sin cuentas → CTA para
solicitar una cuenta.

A-02 · Mis cuentas (Cliente)
Tabla de cuentas: tipo, número de cuenta, saldo, estado
(Activa/Inactiva/Desactivada), menú de acciones a la derecha (Ver detalle).
Badges de estado con tintes semánticos. Estado vacío explicativo.

A-03 · Detalle de cuenta (Cliente)
Header con saldo disponible (número hero), tipo de cuenta, número completo
con botón copiar y badge de estado. Alerta informativa si la cuenta está
inactiva o en riesgo del proceso automático de desactivación (inactiva con
balance menor a Q 50.00 por 6 meses). Tabla de movimientos: fecha,
descripción, débito/crédito con signo y color semántico, saldo resultante.

A-04 · Crear cuenta (Cajero)
Formulario: buscador de cliente (por documento o username, con resultado
seleccionable que muestra nombre y estado de identidad verificada), selector
de tipo de cuenta (tarjetas Monetaria / Ahorro), depósito inicial opcional
en Q. Confirmación en modal con resumen y estado final con el accountId
generado y botón copiar.

A-05 · Depósito en ventanilla (Cajero)
Formulario: número de cuenta destino (con validación y muestra del nombre
del titular al encontrarse), monto en Q, descripción. Flujo en 2 pasos:
confirmación → resultado. El resultado refleja el estado real: Pendiente
(procesando, con identificador) vs. Exitoso (confirmado) vs. Error de
negocio (cuenta inexistente o inactiva).

A-06 · Gestión de cuentas (Admin)
Tabla global de cuentas: número, titular, tipo, saldo, estado, última
actividad. Filtros por estado y tipo, búsqueda. Panel o badge que visibiliza
el proceso automático: "cuentas inactivas con balance < Q 50.00 próximas a
desactivarse" y registro de desactivaciones automáticas recientes.










### MÓDULO 3 — TRANSACTION SERVICE (transferencias)

T-01 · Nueva transferencia (Cliente)
Formulario: cuenta origen (selector que muestra saldo disponible por
cuenta), cuenta destino (número de cuenta, valida formato), monto en Q
(validación local de fondos suficientes), descripción opcional. Errores de
validación junto a cada campo; botón "Continuar".

T-02 · Confirmación de transferencia (Cliente)
Resumen claro: origen → destino con titulares, monto destacado en Q, nota de
que la operación se procesa de forma asíncrona. Botones "Confirmar
transferencia" (primario) y "Volver" (secundario).

T-03 · Estado de transferencia / tracking (Cliente) — PANTALLA CLAVE
Pantalla de seguimiento de la operación distribuida con 4 variantes:
(a) PENDIENTE/EN PROCESO: badge ámbar "En proceso", transactionId y
correlationId visibles con botón copiar, timeline de pasos del Saga
(Fondos validados → Débito aplicado → Crédito aplicado → Completada) con
los pasos completados marcados en verde y el actual en ámbar.
(b) COMPLETADA: badge verde, resumen de la transferencia, fecha con zona
horaria, CTA "Ver en historial".
(c) FALLIDA (error de negocio): badge rojo, motivo de dominio claro
("Fondos insuficientes" o "Cuenta destino inactiva") SIN detalles técnicos,
y nota de que el débito fue revertido (compensación) cuando aplique.
(d) TIMEOUT: mensaje "No pudimos confirmar el resultado", preserva el
transactionId, ofrece "Actualizar estado" y "Reintentar" (explicando que el
reintento es seguro y no duplica la operación).

T-04 · Historial de transacciones (Cliente)
Tabla: fecha, cuenta origen, cuenta destino, monto en Q, estado (badge:
Completada/En proceso/Fallida), menú de acciones. Filtros por estado y
rango de fechas; búsqueda por transactionId. Fila expandible o detalle con
transactionId y correlationId copiables y el timeline del Saga. Estado
vacío: "Aún no tienes transferencias" con CTA.

T-05 · Monitoreo de transacciones (Admin)
Vista global: métricas del día (totales por estado), tabla de todas las
transacciones con filtros por estado/fecha y búsqueda por transactionId o
correlationId. Detalle con la traza completa del Saga (eventos con
timestamp y servicio que los emitió) y compensaciones cuando existan.








### MÓDULO 4 — PAYMENT SERVICE (pagos)

G-01 · Nuevo pago (Cliente)
Selector de tipo: Pago interno (entre cuentas/servicios propios) o Pago
externo (simulado a otro banco/servicio: luz, agua, teléfono). Campos:
cuenta origen con saldo, servicio o cuenta destino, monto en Q, referencia.
Validación local por campo.

G-02 · Estado de pago (Cliente)
Mismo patrón asíncrono que transferencias: Pendiente (con paymentId y
transactionId asociado, botón copiar) → Confirmado (badge verde, resumen) /
Fallido (motivo de negocio, ej. "El sistema externo rechazó el pago") /
Timeout con reintento seguro.

G-03 · Historial de pagos (Cliente)
Tabla: paymentId, servicio/destino, referencia, monto, estado (badge),
fecha. Filtros y búsqueda; estado vacío con CTA "Realizar tu primer pago".

G-04 · Monitoreo de pagos (Admin y Cajero)
Tabla global de pagos con estados, fallos de integración externa
destacados, filtros y detalle con paymentId + transactionId.









### MÓDULO 5 — NOTIFICATION & AUDIT SERVICE (notificaciones y auditoría)

N-01 · Centro de notificaciones (Cliente)
Lista de notificaciones: icono por tipo, título, descripción breve, fecha
relativa; estado leído/no leído (no leídas con indicador de color y fondo
sutil); acción "Marcar todas como leídas". Ejemplos: "Tu cuenta fue
activada", "Transferencia completada", "Pago confirmado", "Tu identidad fue
verificada", "Cuenta próxima a desactivarse". Estado vacío amigable.

N-02 · Auditoría de eventos (Admin) — validación del microservicio
Tabla de eventos del sistema: eventId, tipo de evento
(customer.registered, account.created, transfer.completed,
payment.failed…), servicio origen, timestamp con zona horaria,
correlationId. Filtros por tipo de evento, servicio y rango de fechas;
búsqueda por correlationId (para ver todos los eventos de un mismo flujo).

N-03 · Detalle de evento de auditoría (Admin)
Modal o panel lateral con: todos los metadatos del evento y el PAYLOAD
completo en un visor JSON con resaltado de sintaxis, correlationId con
botón copiar y enlace "Ver todos los eventos de esta correlación".






### MÓDULO 6 — DASHBOARDS POR ROL

D-01 · Dashboard del Cajero (Inicio)
Tarjetas métricas: validaciones de identidad pendientes, cuentas creadas
hoy, depósitos del día (Q). Cola de validaciones reciente con CTA a
revisar. Accesos rápidos: Crear cuenta, Registrar depósito.

D-02 · Dashboard del Administrador (Inicio)
Métricas del sistema en tarjetas: clientes registrados, cuentas activas,
transferencias del día (y tasa de fallo), pagos procesados. Gráficas:
barras con transacciones por día (bordes superiores redondeados, tooltip
con valor exacto) y donut de estados de operaciones (tonos verdes y
neutros, sin competir con los colores de estado). Sección de alertas
operativas: transferencias fallidas, timeouts y eventos recientes de
auditoría relevantes.






### MÓDULO 7 — TRANSVERSALES

X-01 · 404 / Sin permisos
Página de error amigable con CTA al inicio según rol.












6. ESTADOS TRANSVERSALES OBLIGATORIOS
-------------------------------------
En toda pantalla con datos o acciones, representar donde aplique:
1. Inicial (explica la tarea, sin simular datos inexistentes).
2. Vacío (por qué está vacío + siguiente acción útil).
3. Validación local (mensaje junto al campo, conserva lo válido).
4. Enviando (sin doble envío, progreso visible, contexto conservado).
5. Pendiente (aceptada pero NO completada: badge ámbar + identificador de
   seguimiento).
6. Éxito (solo cuando el flujo confirma, con resumen y siguiente acción).
7. Error de negocio (razón de dominio clara, sin detalles técnicos).
8. Timeout (resultado desconocido, preserva el identificador, ofrece
   actualizar estado; nunca afirma que falló).
9. Reintento seguro (idempotente o explica qué se reintentará).

7. DATOS DE EJEMPLO SUGERIDOS
-----------------------------
Nombres guatemaltecos realistas (ej. "María Fernanda López García",
"José Carlos Méndez"), DPI de 13 dígitos, usernames generados del nombre
(ej. "mlopez", "jmendez"), números de cuenta de 10 dígitos, montos en Q
variados (Q 50.00 a Q 25,000.00), y transacciones en los 3 estados
(Completada, En proceso, Fallida) para que se aprecien los badges.

ENTREGABLE: genera todas las pantallas listadas (P, C, A, T, G, N, D, X)
como un prototipo navegable y consistente, aplicando el DESIGN.md adjunto
en cada una. Prioriza la legibilidad del dinero y la distinción visual
entre operaciones pendientes y completadas por encima de cualquier adorno.
-----------------------------
Las imagenes adjuntas son ejemplos, no los temas como pantallas reales del negocio, unicamente son una guia visual.
Analiza cada una, y haz una equivalencia a la vista segun corresponda a nuestra logica del negocio.