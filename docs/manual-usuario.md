# Manual de Usuario — Bank USAC

## Índice
- [Manual de Usuario — Bank USAC](#manual-de-usuario--bank-usac)
  - [Índice](#índice)
  - [Objetivos](#objetivos)
    - [General](#general)
    - [Específicos](#específicos)
  - [Introducción](#introducción)
  - [Requisitos del Sistema](#requisitos-del-sistema)
    - [Requisitos de Hardware](#requisitos-de-hardware)
    - [Requisitos de Software](#requisitos-de-software)
    - [Navegadores Web Compatibles](#navegadores-web-compatibles)
    - [Requisitos de Red y Conectividad](#requisitos-de-red-y-conectividad)
  - [Flujo de Funcionalidades del Programa](#flujo-de-funcionalidades-del-programa)
    - [1. Registro y Verificación de Identidad](#1-registro-y-verificación-de-identidad)
    - [2. Control de Acceso y Gestión de Sesión](#2-control-de-acceso-y-gestión-de-sesión)
    - [3. Gestión Integral de Cuentas](#3-gestión-integral-de-cuentas)
    - [4. Transferencias Monetarias y Orquestación Saga](#4-transferencias-monetarias-y-orquestación-saga)
    - [5. Pago de Servicios Básicos](#5-pago-de-servicios-básicos)
    - [6. Auditoría y Trazabilidad Forense](#6-auditoría-y-trazabilidad-forense)
    - [7. Centro de Notificaciones](#7-centro-de-notificaciones)
  - [Guías Especializadas por Rol](#guías-especializadas-por-rol)
  - [Recorrido Visual Paso a Paso](#recorrido-visual-paso-a-paso)
- [1. Antes de empezar](#1-antes-de-empezar)
  - [1.1 Qué necesitas](#11-qué-necesitas)
  - [1.2 Los tres roles](#12-los-tres-roles)
  - [1.3 Usuarios de prueba](#13-usuarios-de-prueba)
- [2. Cómo entrar al sistema](#2-cómo-entrar-al-sistema)
  - [2.1 Crear tu cuenta](#21-crear-tu-cuenta)
  - [2.2 Activar la cuenta](#22-activar-la-cuenta)
  - [2.3 Iniciar sesión](#23-iniciar-sesión)
  - [2.4 Cerrar sesión](#24-cerrar-sesión)
  - [2.5 Si olvidaste tu contraseña](#25-si-olvidaste-tu-contraseña)
- [3. Cómo leer lo que el sistema te responde](#3-cómo-leer-lo-que-el-sistema-te-responde)
  - [3.1 Los estados de una operación](#31-los-estados-de-una-operación)
  - [3.2 Mensajes de confirmación](#32-mensajes-de-confirmación)
  - [3.3 Mensajes de error](#33-mensajes-de-error)
- [4. Clientes](#4-clientes)
  - [4.1 Registrar un cliente nuevo](#41-registrar-un-cliente-nuevo)
  - [4.2 Ver la información de un cliente](#42-ver-la-información-de-un-cliente)
  - [4.3 Validar la identidad de un cliente](#43-validar-la-identidad-de-un-cliente)
- [5. Cuentas](#5-cuentas)
  - [5.1 Abrir una cuenta](#51-abrir-una-cuenta)
  - [5.2 Ver el detalle y movimientos de una cuenta](#52-ver-el-detalle-y-movimientos-de-una-cuenta)
  - [5.3 Recibir un depósito en ventanilla](#53-recibir-un-depósito-en-ventanilla)
  - [5.4 Activar o desactivar una cuenta](#54-activar-o-desactivar-una-cuenta)
- [6. Transferencias](#6-transferencias)
  - [6.1 Enviar una transferencia](#61-enviar-una-transferencia)
  - [6.2 Ver el estado de una transferencia en curso](#62-ver-el-estado-de-una-transferencia-en-curso)
  - [6.3 Ver el historial de transferencias](#63-ver-el-historial-de-transferencias)
- [7. Pagos](#7-pagos)
  - [7.1 Pagar un servicio](#71-pagar-un-servicio)
  - [7.2 Consultar el historial de pagos](#72-consultar-el-historial-de-pagos)
  - [7.3 Monitorear los pagos del banco](#73-monitorear-los-pagos-del-banco)
- [8. Auditoría y notificaciones](#8-auditoría-y-notificaciones)
  - [8.1 Explorador general de eventos y rastro por operación](#81-explorador-general-de-eventos-y-rastro-por-operación)
  - [8.2 Notificaciones](#82-notificaciones)
- [9. Lo que el sistema todavía no puede hacer](#9-lo-que-el-sistema-todavía-no-puede-hacer)
- [10. Preguntas frecuentes](#10-preguntas-frecuentes)

---

## Objetivos

### General
Instruir de forma clara, didáctica y exhaustiva a los usuarios finales (Cuentahabientes, Cajeros Receptores y Administradores de Operaciones) sobre el manejo, la interacción y el flujo operativo completo de la plataforma bancaria **Bank USAC**, garantizando un uso correcto, seguro y eficiente de todas las funcionalidades financieras y administrativas.

### Específicos
1. **Guiar en los procesos de onboarding y acceso**: Detallar los pasos requeridos para el autorregistro de clientes, la carga de documento de identificación (DPI), la activación de credenciales y el inicio de sesión seguro.
2. **Capacitar en la operativa bancaria diaria**: Describir con precisión la apertura de cuentas monetarias y de ahorro, depósitos en ventanilla, transferencias entre cuentas y pagos de servicios esenciales.
3. **Transparentar el modelo transaccional y estados Saga**: Explicar la interpretación de saldos, débitos, créditos, estados de transferencias en tiempo real y el mecanismo de compensación automática en caso de fallos.
4. **Instruir en el control y seguridad de cuentas**: Documentar los procedimientos de activación y desactivación (congelamiento preventivo) de cuentas por parte del propio cliente, del cajero receptor y del administrador.
5. **Orientar sobre las herramientas de auditoría y monitoreo**: Facilitar a los administradores la consulta de eventos distribuidos, rastro por identificador de correlación y supervisión de notificaciones.

---

## Introducción

El sistema **Bank USAC** es una solución bancaria integral desarrollada bajo una arquitectura de microservicios distribuidos orientada a eventos. Su diseño simula con alto rigor técnico la operativa de una entidad financiera moderna en Guatemala, combinando consistencia financiera estricta, alta disponibilidad, segregación estricta de responsabilidades y trazabilidad forense inmutable.

A través de una interfaz web intuitiva, reactiva y elegante, Bank USAC conecta a tres actores fundamentales:
- **Clientes (Cuentahabientes)**: Personas individuales que autogestionan sus finanzas, monitorean sus cuentas en Quetzales (GTQ), efectúan transferencias interbancarias/internas, pagan servicios domiciliarios y controlan el estado de sus productos bancarios.
- **Cajeros Receptores**: Personal operativo de ventanilla responsable de atender al público presencial, validar identidades contra documentos oficiales, aperturar cuentas bancarias, registrar depósitos monetarios en efectivo y asistir en transferencias asistidas.
- **Administradores del Sistema**: Supervisores de operaciones encargados del gobierno de la plataforma, control global de estados de cuentas, observabilidad transaccional en tiempo real y análisis forense del bus de eventos.

La plataforma implementa el patrón **Saga Coreografiada**, lo que garantiza que ante cualquier fallo técnico o rechazo de una entidad externa (por ejemplo, pasarela de pago o servicios no disponibles), el sistema revierte automáticamente cualquier movimiento de fondos, protegiendo en todo instante la integridad del dinero del cuentahabiente y cumpliendo la regla fundamental de saldo no negativo (`balance >= 0`).

---

## Requisitos del Sistema

Para interactuar con la plataforma Bank USAC, el equipo cliente o terminal de ventanilla debe cumplir con los siguientes requerimientos mínimos:

### Requisitos de Hardware
- **Procesador (CPU)**: 1.5 GHz de doble núcleo (x86_64 o ARM64) o superior.
- **Memoria RAM**: 2 GB de RAM mínima disponible (se recomiendan 4 GB para una experiencia fluida con múltiples pestañas).
- **Pantalla**: Resolución mínima recomendada de 1280 x 720 píxeles (diseño responsive adaptable a portátiles, escritorios y tablets).
- **Dispositivos de Entrada**: Teclado y ratón (o panel táctil).

### Requisitos de Software
- **Sistema Operativo**: Cualquier sistema operativo con soporte para navegadores modernos (Microsoft Windows 10/11, macOS 12+, GNU/Linux Ubuntu/Debian/Fedora, o ChromeOS).
- **Lector de Documentos (Opcional)**: Visor de archivos PDF o visores de imágenes (JPG, PNG) para verificar comprobantes descargados y fotos de documentos de identidad.

### Navegadores Web Compatibles
El sistema hace uso de estándares web modernos (HTML5, CSS3, ECMAScript 2022, WebSocket/SSE y Fetch API). Se garantiza compatibilidad en las siguientes versiones o superiores:
- **Google Chrome**: Versión 110 o superior (Recomendado).
- **Mozilla Firefox**: Versión 115 o superior.
- **Microsoft Edge**: Versión 110 o superior.
- **Apple Safari**: Versión 16 o superior.
- *Nota*: Es indispensable tener habilitada la ejecución de JavaScript y permitir cookies/almacenamiento de sesión para el token JWT de autenticación.

### Requisitos de Red y Conectividad
- **Conexión de Red**: Conexión a Internet o red local corporativa con un ancho de banda mínimo de 1 Mbps simétrico.
- **Latencia**: Latencia de red inferior a 300 ms hacia los servidores de la aplicación.
- **Protocolos y Puertos**: Acceso HTTP/HTTPS estándar (puerto `3010` para interfaz web en entorno local, puerto `3000` para API Gateway, o puertos estándar `80`/`443` en despliegues cloud).

---

## Flujo de Funcionalidades del Programa

El sistema se estructura en 7 grandes flujos de funcionalidad interconectados, diseñados para garantizar una navegación fluida y segura:

### 1. Registro y Verificación de Identidad
Permite a cualquier ciudadano mayor de edad registrarse en la plataforma proporcionando datos personales, dirección física, correo electrónico y fotografía digital de su Documento Personal de Identificación (DPI). El sistema valida el formato de la imagen, almacena el archivo de forma segura en almacenamiento de objetos (MinIO/Cloud Storage) y genera un token criptográfico de activación enviado al usuario. El cajero o administrador puede posteriormente verificar la concordancia visual y digital de la identificación en la cola de validación.

### 2. Control de Acceso y Gestión de Sesión
Autenticación basada en credenciales robustas (correo y contraseña protegida mediante hash scrypt). El sistema emite un token JWT con vigencia temporal que encapsula el rol (`CLIENTE`, `CAJERO_RECEPTOR` o `ADMINISTRADOR`), delimitando de forma estricta los privilegios en la barra de navegación y en las APIs internas. Incluye recuperación de contraseña por token firmado y cierre de sesión seguro en un clic.

### 3. Gestión Integral de Cuentas
Apertura de cuentas monetarias y de ahorro en Quetzales, generación de números de cuenta de 10 dígitos algorítmicamente validados, consulta de saldo en tiempo real con precisión decimal exacta (`NUMERIC(14,2)`), historial de movimientos (débitos y créditos) y módulo de depósitos en efectivo en ventanilla. Adicionalmente, cuenta con el mecanismo de **congelamiento y reactivación** (activar/desactivar estado `ACTIVA` / `INACTIVA`) disponible tanto para el cuentahabiente como para el personal bancario.

### 4. Transferencias Monetarias y Orquestación Saga
Transferencias inmediatas entre cuentas bancarias. Cada transferencia se ejecuta bajo una Saga de transacciones compensatorias:
1. Verificación de titularidad y existencia de cuentas.
2. Débito atómico con bloqueo concurrente en la cuenta origen.
3. Intento de crédito en la cuenta destino.
4. Si la cuenta destino no existe, está inactiva o el sistema de pago rechaza la operación, se ejecuta la compensación devolviendo íntegramente el dinero a la cuenta origen sin intervención manual.
La interfaz ofrece un monitor en vivo con barra de progreso visual de las etapas de la Saga.

### 5. Pago de Servicios Básicos
Convenios directos para el pago de servicios públicos esenciales (Empresa Eléctrica EEGSA, Servicio de Agua Empagua, Telecomunicaciones Claro). El usuario selecciona el proveedor, ingresa su número de suministro o contrato y realiza el pago con cargo directo a su cuenta de cheques o ahorro, obteniendo comprobante digital y rastro de operación.

### 6. Auditoría y Trazabilidad Forense
Exclusivo para el rol Administrador. Permite consultar la bitácora distribuida de eventos emitidos por todos los microservicios en el broker RabbitMQ. Permite rastrear cualquier transacción introduciendo su `correlationId` para auditar la cronología exacta: qué servicio procesó el comando, en qué microsegundo y con qué resultado, garantizando cumplimiento regulatorio bancario con ofuscación de datos sensibles.

### 7. Centro de Notificaciones
Buzón accesible mediante icono de campana en el encabezado superior. Muestra al usuario notificaciones en tiempo real sobre transacciones exitosas, transferencias recibidas, débitos realizados, activaciones de cuenta y cambios de seguridad. Incluye filtros por estado (leídas/no leídas) y marcación rápida.

---

## Guías Especializadas por Rol

Para una descripción operativa paso a paso orientada específicamente a su puesto de trabajo o perfil, consulte los manuales dedicados:

- **[Manual del Cliente](manual/rol-cliente.md)**: Guía completa para el cuentahabiente (apertura de productos, gestión de saldos, congelamiento de cuenta, transferencias y pagos).
- **[Manual del Cajero Receptor](manual/rol-cajero-receptor.md)**: Operaciones de ventanilla, recepción de depósitos, validación de DPIs y apertura de cuentas asistidas.
- **[Manual del Administrador](manual/rol-administrador.md)**: Gobierno de cuentas, auditoría forense, monitoreo de la Saga y supervisión global del sistema.

## Recorrido Visual Paso a Paso

- **[Recorrido visual interactivo](manual/recorrido-visual.md)**: 78 capturas de pantalla secuenciales con datos concretos que ilustran cada una de las pantallas de la plataforma en funcionamiento.

---

## 1. Antes de empezar

### 1.1 Qué necesitas

Un navegador web y la dirección del sistema. En una instalación local —la que se
usa para las demostraciones y la evaluación— la dirección es:

| Para | Dirección |
| --- | --- |
| La aplicación (lo que usan las personas) | <http://localhost:3010> |
| La API del banco (no la usa una persona) | <http://localhost:3000> |

No necesitas instalar nada más. El sistema no tiene aplicación móvil ni de
escritorio.

### 1.2 Los tres roles

Cada persona entra al sistema con **un rol**, y el rol decide qué pantallas ve.
El rol se asigna cuando se registra la persona y no se cambia desde la
aplicación.

| Rol | Quién es | Qué módulos ve en el menú |
| --- | --- | --- |
| **Cliente** (`CLIENTE`) | El cuentahabiente. Opera sobre sus propias cuentas. | Inicio, Clientes, Cuentas, Transferencias, Pagos |
| **Cajero receptor** (`CAJERO_RECEPTOR`) | Personal de ventanilla. Registra clientes, abre cuentas, recibe depósitos y transfiere por el cliente que tiene enfrente. | Inicio, Clientes, Cuentas, Transferencias, Pagos |
| **Administrador** (`ADMINISTRADOR`) | Supervisa la operación: administra cuentas y consulta el rastro de auditoría. | Inicio, Clientes, Cuentas, Transferencias, Pagos, Auditoría |

Todos los roles tienen además dos pantallas fuera del menú lateral, en el menú
de tu nombre arriba a la derecha: **Mi perfil** (tus datos y tu contraseña) y
**Notificaciones**, a la que también lleva la campana de la barra superior.

El menú lateral izquierdo muestra solo los módulos de tu rol, y debajo de tu
nombre aparece siempre el rol con el que estás operando. Si escribes en la barra
de direcciones la ruta de un módulo que tu rol no tiene, el sistema te devuelve
al inicio en lugar de mostrarlo.

**Auditoría es el único módulo que se oculta por rol.** Los demás los ven los
tres, y lo que cambia es lo que ofrecen adentro: en *Clientes*, un Cliente
encuentra solo su propia ficha, mientras que el personal ve además el registro
de nuevos clientes, la cola de validación de identidad y la búsqueda por número
de cliente.

Las dos diferencias entre los tres menús son **Clientes**, que es trabajo del
personal del banco, y **Auditoría**, que es solo del Administrador. Todo lo
demás lo ven los tres; lo que cambia es el alcance: un Cliente ve sus cuentas y
sus transferencias, no las de los demás, y esa restricción la aplica el servicio
que guarda el dato, no la pantalla.

Un **Cliente** ve sólo sus propias cuentas y sus propios movimientos: esa
restricción no depende de la pantalla, la aplica el servicio que guarda el
dinero.

### 1.3 Usuarios de prueba

> **Usuarios de demostración precargados.** Para facilitar pruebas y evaluaciones locales,
> el script de inicialización (`pnpm seed:demo` o inicialización de base de datos)
> precarga las credenciales de prueba para los tres roles del sistema con la contraseña `BankUsac#2026`:
>
> * **Administrador**: `admin@bankusac.gt` / `BankUsac#2026`
> * **Cajero Receptor**: `cajero@bankusac.gt` / `BankUsac#2026`
> * **Cliente Principal**: `2895884051401@ingenieria.usac.edu.gt` / `BankUsac#2026` (Marco Tulio López)
> * **Cliente Secundario**: `cliente@bankusac.gt` / `BankUsac#2026` (Clara Cliente)

Reglas de registro en nuevas instalaciones:

- El **registro público** (`/registro`) siempre crea un **Cliente**. Nunca un
  cajero ni un administrador; el sistema lo fuerza, para que nadie pueda
  nombrarse administrador a sí mismo.
- Para crear un **Cajero receptor** o un **Administrador** adicional hace falta que un
  **Administrador ya existente** los registre desde *Clientes → Nuevo cliente*,
  eligiendo el rol en el primer paso.
- El **primer administrador** no puede crearse desde la aplicación. Lo prepara
  el equipo técnico al instalar el sistema. Si vas a operar como administrador y
  todavía no tienes usuario, pídeselo a quien instaló el sistema.

---

## 2. Cómo entrar al sistema

Entrar tiene tres pasos y hay que hacerlos en orden: **registrarse**,
**activar la cuenta desde el correo** y **iniciar sesión**. Sin activación no se
puede iniciar sesión.

### 2.1 Crear tu cuenta

Abre <http://localhost:3010/registro> y sigue el asistente de **tres pasos**.

**Paso 1 — Datos personales**

| Campo | Qué escribir |
| --- | --- |
| Nombre completo | Al menos un nombre y un apellido. Máximo 200 caracteres. |
| Fecha de nacimiento | Debes tener **18 años o más**. El campo te muestra la edad mientras escribes. |
| Dirección | Máximo 300 caracteres. |
| Correo electrónico | A este correo llega el enlace de activación, así que tiene que ser uno al que tengas acceso. |

**Paso 2 — Documento de identidad**

| Campo | Qué escribir |
| --- | --- |
| Número de DPI | Exactamente **13 dígitos**. Puedes escribirlos con espacios. |
| Foto del documento | Arrastra la foto o selecciónala. **JPG o PNG, máximo 5 MB.** |

Si la imagen no cumple —formato equivocado o demasiado pesada— el sistema te lo
dice de inmediato y no envía nada. Cambia el archivo y continúa.

**Paso 3 — Confirmación**

Aquí revisas todo lo que escribiste y creas la contraseña.

| Campo | Qué escribir |
| --- | --- |
| Username generado | No se escribe: el sistema lo propone a partir de tu nombre (por ejemplo, `mlopez`). Es una previsualización; si ese usuario ya existe, el sistema le añade un sufijo. |
| Contraseña | Mínimo **8 caracteres**. |
| Confirmar contraseña | Debe coincidir con la anterior. |
| Términos y condiciones | Hay que aceptarlos para continuar. |

Pulsa **Crear cuenta**. Si algo quedó mal, el asistente te devuelve al paso
donde está el error.

**Qué pasa después.** El sistema responde *«Solicitud de registro recibida»* y te confirma que envió de inmediato el correo de activación a tu bandeja de entrada. En esa pantalla aparecen tres datos importantes que conviene copiar:

- el **Número de cliente** (`customerId`), que es tu identificador único,
- el **Usuario** generado por el sistema, y
- el **Código de seguimiento** (`correlationId`), útil para rastrear la operación si requieres soporte.

### 2.2 Activar la cuenta desde el correo

La cuenta nace en estado `PENDING_ACTIVATION`. Para activarla hay que abrir el enlace que el
sistema te envió por correo electrónico.

Al abrirlo llegas a la pantalla de **Activación de cuenta**, que te da uno de
estos tres resultados:

| Lo que ves | Qué significa | Qué hacer |
| --- | --- | --- |
| «Tu cuenta está activa. Ya puedes iniciar sesión.» | Todo salió bien. | Pulsa **Ir a iniciar sesión**. |
| «El enlace de activación no es válido o ya fue utilizado.» | El enlace ya se usó, venció, o no es el correcto. | Regístrate de nuevo o pide ayuda. |
| «No pudimos confirmar el resultado» | El sistema tardó demasiado en responder. **No significa que falló.** | Espera unos segundos y vuelve a abrir el enlace. |

**Estado de verificación de identidad (KYC) y operaciones:**

- **Registro público autoservicio:** Una vez activada la cuenta por correo, puedes iniciar sesión inmediatamente. Podrás explorar tu perfil y consultar tus cuentas. Sin embargo, por normativas de seguridad bancaria, las operaciones transaccionales (**transferencias** y **pagos de servicios**) permanecerán bloqueadas mostrando una advertencia de *«Verificación de identidad pendiente»* hasta que un cajero o administrador valide tu documento de identidad en el sistema.
- **En caso de rechazo del documento:** Si el expediente digital es rechazado, recibirás un correo electrónico notificándote del rechazo y solicitándote acudir a cualquier agencia bancaria de Bank USAC con tu DPI físico original para validar tu identidad presencialmente.
- **Registro presencial en agencia (por Cajero o Administrador):** Si el cliente es dado de alta directamente en ventanilla por un cajero receptor o administrador (desde el menú *Clientes → Nuevo cliente*), el empleado valida el documento físico en mano; por lo tanto, la cuenta queda **activa** y **verificada** de inmediato, permitiendo operar sin bloqueos desde el primer momento.

> **Envíos de correo:** En despliegues locales, el servicio de notificaciones envía los correos reales si se encuentra configurada la clave de proveedor (Resend), o registra el enlace en los logs de `customer-service` y `notification-audit-service` para fácil acceso en pruebas.

### 2.3 Iniciar sesión

Abre <http://localhost:3010/login>, escribe el **correo** con el que te
registraste y tu **contraseña**, y pulsa **Entrar**.

Si algo no cuadra verás siempre el mismo mensaje: *«No pudimos iniciar sesión
con esos datos.»* El sistema no te dice si falló el correo, la contraseña, o si
la cuenta aún no está activa — y lo hace a propósito, para que nadie pueda
averiguar desde esta pantalla qué correos están registrados en el banco. Si
acabas de registrarte y no puedes entrar, lo más probable es que falte activar
la cuenta.

### 2.4 Cerrar sesión

El botón **Cerrar sesión** está al final del menú lateral, siempre visible.

> **La sesión no sobrevive a recargar la página.** Si actualizas el navegador o
> cierras la pestaña, el sistema te pide iniciar sesión otra vez. Es
> intencional: la sesión vive solo en la memoria del navegador y nunca se
> guarda en el disco. La sesión también caduca sola después de una hora.

---

## 3. Cómo leer lo que el sistema te responde

Esta sección es corta pero es la más útil del manual. Bank USAC no funciona como
una aplicación que hace las cosas mientras esperas: **acepta** tu solicitud, te
responde de inmediato, y la ejecuta después. Entender eso evita casi todas las
confusiones.

### 3.1 «Solicitud recibida» no quiere decir «hecho»

Cuando envías un registro, abres una cuenta o haces una transferencia, la
primera respuesta casi siempre es:

> **Solicitud aceptada, aún no completada**
> El sistema recibió tu solicitud y la está procesando de forma asíncrona.

Eso significa que el banco **anotó** lo que pediste y lo está ejecutando. No
significa que ya ocurrió, y tampoco significa que falló. El resultado real se
consulta después.

### 3.2 Los mensajes que vas a ver

Todas las pantallas usan los mismos siete avisos. Vale la pena reconocerlos:

| Aviso | Qué pasó | Qué hacer |
| --- | --- | --- |
| **Solicitud aceptada, aún no completada** | El banco recibió la solicitud y la está procesando. | Esperar o consultar el resultado después. |
| **Operación completada** | El sistema confirmó el resultado. | Nada. |
| **La operación fue rechazada** | Un servicio del banco no pudo completarla con los datos enviados. | Revisar los datos y volver a intentar. |
| **No pudimos confirmar el resultado** | Nadie respondió a tiempo. **La operación sigue en el sistema: no asumas que falló.** | Guardar el identificador de correlación y volver a consultar. Reintentar es seguro. |
| **El sistema no pudo aceptar la solicitud** | La solicitud nunca llegó a procesarse. **No se cambió nada.** | Intentar de nuevo en unos momentos. |
| **Revisa los datos enviados** | El formulario tiene un error y no se envió nada. | Corregir lo marcado. |
| **Ocurrió un error inesperado** | Falla no prevista. | Guardar el identificador de correlación y reportarlo. |

La diferencia entre los dos avisos rojos importa: *«El sistema no pudo aceptar
la solicitud»* garantiza que **no se movió nada**; *«No pudimos confirmar el
resultado»* **no** lo garantiza — solo dice que nadie contestó a tiempo.

### 3.3 El identificador de correlación

Cada operación lleva un identificador que la acompaña por todo el banco. Aparece
al pie de las pantallas, con un botón para copiarlo. Es el dato que hay que dar
cuando algo sale mal: con él, un administrador puede reconstruir exactamente qué
pasó.

**Cópialo siempre que una operación no termine con una confirmación clara.**

### 3.4 La clave de idempotencia: reintentar es seguro

Debajo de los formularios que mueven dinero o crean cosas verás un bloque
llamado **Clave de idempotencia**. Es la forma que tiene el sistema de reconocer
que dos envíos son *el mismo intento* y no dos operaciones distintas.

En la práctica esto te da una garantía: **si pulsas enviar dos veces, o si
reintentas después de un error, no se duplica nada**. La clave solo cambia
cuando tú empiezas una operación genuinamente nueva (por ejemplo, con los
botones *Registrar otro* o *Abrir otra cuenta*).

### 3.5 Los montos

Todos los montos están en quetzales y se muestran con dos decimales: `Q
1,250.00`. El monto mínimo de una transferencia es **Q 0.01**, y no se aceptan
más de dos decimales — el campo los rechaza en vez de redondearlos.

---

## 4. Clientes

**Quién lo ve:** Cajero receptor y Administrador. **Ruta:** `/clientes`.

Este módulo no es una lista de clientes: es un conjunto de accesos. El sistema
todavía no ofrece una búsqueda de clientes, así que para abrir la ficha de
alguien hay que tener su **customerId**.

Un **Cliente** no ve este módulo, y no le hace falta: sus propios datos y su
contraseña están en *Mi perfil*.

### 4.1 Registrar un cliente

Botón **Nuevo cliente**. Es el mismo asistente de tres pasos de la sección 2.1,
con una diferencia: en el primer paso aparece un campo **Rol**, donde eliges si
la persona será Cliente, Cajero receptor o Administrador.

**La lista ofrece los tres roles, pero solo un Administrador puede crear
personal del banco.** Si un Cajero receptor elige Cajero receptor o
Administrador, el banco rechaza el registro. Desde ventanilla, el rol que
funciona es **Cliente**.

El registro dispara el correo de activación igual que el registro público: la
persona no podrá iniciar sesión hasta abrir ese enlace.

### 4.2 Mis datos

Botón **Abrir mi ficha**, o **Mi perfil** en el menú de tu nombre — que es por
donde llega un Cliente. En cualquiera de las dos verás tus datos actuales y
podrás cambiar tu **nombre completo**, tu **dirección** y tu **fecha de
nacimiento**.

Escribe solo lo que quieras cambiar: un campo vacío se deja como está. Tienes
que cambiar al menos un dato para poder guardar.

**Mi perfil** añade el cambio de **contraseña**, que pide la actual antes de
aceptar la nueva. Nadie puede cambiar la contraseña de otra persona,
administradores incluidos: para eso está la recuperación por correo, que llega a
la bandeja de su dueño. Quien no recuerda la actual usa ese camino.

**El correo y el username no se pueden modificar** desde la aplicación.

### 4.3 Abrir la ficha de otra persona

En la tarjeta **Abrir una ficha**, pega el customerId (el identificador largo
que devolvió el registro) y pulsa **Abrir**. El botón se habilita cuando el
identificador tiene la forma correcta.

### 4.4 Validación de identidad

**Quién lo ve:** Cajero receptor y Administrador.

La cola de identidades pendientes de revisar, con el nombre y el correo de cada
cliente que espera. **Revisar** abre uno: arriba, sus datos declarados; abajo,
los botones **Aprobar identidad** y **Rechazar**. El veredicto se envía al
banco y no se puede deshacer; un rechazo avisa al cliente y le permite volver a
subir su documento.

El cliente sale de la cola cuando el banco termina de procesar el veredicto, no
en el instante del clic.

> **Lo único que falta aquí es la foto.** La imagen del documento se guarda al
> registrarse, pero todavía no hay una pantalla que la muestre: en su lugar
> aparece un recuadro gris que lo explica. La revisión se hace comparando el
> documento físico que la persona presenta con los datos declarados en pantalla.

---

## 5. Cuentas

**Quién lo ve:** los tres roles. **Ruta:** `/cuentas`.

### 5.1 Consultar tus cuentas y su saldo

La pantalla **Mis cuentas** lista tus cuentas con su tipo, su número, su estado
y su saldo, y arriba a la derecha el **Total consolidado** de todas ellas.

Un Cliente ve únicamente sus cuentas. Si todavía no tienes ninguna, la pantalla
te ofrece abrir la primera.

### 5.2 Abrir una cuenta

Botón **Abrir cuenta**. Se hace en los siguientes pasos:

1. **Elige el tipo de cuenta.** Hay dos:

   | Tipo | Para qué | Regla de apertura y depósito |
   | --- | --- | --- |
   | **Monetaria** | Uso diario: transferencias y pagos sin límite de movimientos. | Nace activa con saldo inicial de **Q 0.00**; no requiere depósito previo. |
   | **Ahorro** | Para guardar dinero. Cobra Q 3.00 de comisión por transferencia saliente. | Requiere un depósito inicial mínimo de **Q 100.00**. |

2. **Acreditación y verificación de fondos (solo Ahorro):**
   Para fondear la cuenta de ahorro con su saldo inicial, el sistema presenta la cuenta concentradora de Bank USAC (`001-00000000-01 / GT00-BANK-0001-FONDO-APERTURA`) a la cual se acredita el depósito. El usuario ingresa el monto depositado (mínimo Q 100.00) y su comprobante o boleta (pudiendo generar una boleta de prueba con el botón correspondiente). Al hacer clic en **Verificar depósito**, el sistema simula la comprobación de fondos con la compensación bancaria y confirma la acreditación del comprobante.
3. **Selección del titular (solo personal bancario):**
   Si eres **Cajero receptor** o **Administrador**, puedes seleccionar al cliente titular desde el buscador por nombre o DPI, visualizando su estado de verificación en texto limpio (`[Verificado]` o `[No verificado]`), o ingresar su `customerId` (UUID). Un **Cliente** abre la cuenta a su propio nombre.
4. **Confirma.** Verás el titular, el tipo, el saldo inicial verificado y el comprobante de apertura.
5. **Recibe el identificador.** La cuenta se abre y queda en estado **activa** con su saldo acreditado.

> [!IMPORTANT]
> **Requisito estricto de verificación:** El sistema prohíbe la apertura de cuentas bancarias
> para clientes que no cuenten con su expediente de identidad y KYC aprobado (`VALIDATED` y `VERIFIED`).
> Si un cliente no está verificado, la interfaz inhabilita la apertura mostrando un aviso de bloqueo,
> impidiendo la creación tanto al propio cliente como al personal bancario (cajero y administrador).

> **Guarda el número de cuenta** que aparece al final. Es con lo que se consulta
> el saldo y con lo que se envían transferencias, y no hay forma de buscarlo por
> nombre.

Para ingresar más dinero a una cuenta ya existente hay dos caminos: **recibir una transferencia**, o que un
Cajero receptor o un Administrador registre un **depósito en ventanilla** desde
*Cuentas → Depósito*. Ese depósito responde en el momento —no hay nada que
esperar— y **reactiva la cuenta si estaba inactiva**.

Lo que el sistema no tiene es un **retiro** de efectivo: no hay ninguna
operación que saque dinero de una cuenta salvo una transferencia.

### 5.3 Ver una cuenta y sus movimientos

Pulsa **Ver detalle** en cualquier cuenta de la lista. Arriba verás el **saldo
disponible**, el estado de la cuenta y la fecha del último movimiento; abajo, el
estado de cuenta con una fila por movimiento:

| Columna | Qué muestra |
| --- | --- |
| Fecha | Cuándo ocurrió. |
| Descripción | Débito, Crédito o Compensación, con la transferencia que lo originó. |
| Estado | *Aplicada* o *Compensada*. |
| Débito / Crédito | El monto, con signo: `−` en rojo si salió, `+` en verde si entró. |
| Saldo resultante | Cómo quedó la cuenta después de ese movimiento. |

### 5.4 Cuentas activas e inactivas

| Estado | Qué significa |
| --- | --- |
| **Activa** | La cuenta opera con normalidad: recibe depósitos, transferencias y permite debitar fondos para pagos y envíos. |
| **Inactiva** | La cuenta queda congelada. No se puede transferir dinero fuera de ella ni pagar servicios. Un depósito la reactiva automáticamente, o puede ser reactivada por el propio cliente, por un cajero o por un administrador. |

El banco **desactiva cuentas automáticamente**: si una cuenta pasa **seis meses sin
movimientos con un saldo menor a Q 50.00**, un proceso automático la desactiva.
Cuando una cuenta se acerca a esa condición, su pantalla muestra un aviso
ámbar que dice cuántos días faltan. Para conservarla activa basta con
registrar un movimiento — recibir una transferencia es suficiente.

**Control de activación / desactivación por parte del usuario:**
- **El Cliente**: Desde el detalle de su cuenta (`/cuentas/[id]`), el cuentahabiente dispone del botón dinámico **«Desactivar cuenta»** o **«Activar cuenta»**. Esto le permite suspender preventivamente su cuenta en caso de sospecha de fraude, extravío de tarjeta o preferencia personal, o reactivarla cuando lo requiera, indicando el motivo correspondiente. La interfaz actualiza el estado de forma inmediata y sincroniza el saldo.
- **El Cajero Receptor y el Administrador**: Disponen del panel de **Gestión de cuentas** en `/cuentas`, donde pueden buscar cualquier cuenta bancaria y cambiar su estado (`Activa` / `Desactivada`) ingresando la justificación administrativa correspondiente.
- **Notificación de seguridad al cliente:** Cada vez que una cuenta bancaria es desactivada o reactivada (manual o automáticamente), el sistema emite una notificación de seguridad con severidad **`WARNING`** dirigida al buzón del titular para mantenerlo informado del cambio de estado.

### 5.5 Gestión de cuentas

**Quién lo ve:** Administrador y Cajero Receptor (acceso completo a todas las cuentas); Clientes (gestión directa desde la ficha de su propia cuenta). Botón **Gestión de cuentas** en `/cuentas`.

Muestra **todas** las cuentas del sistema, con filtros por estado y por tipo, y
una búsqueda por número de cuenta o titular. Arriba aparece un aviso cuando hay
cuentas activas con saldo menor a Q 50.00, que son las candidatas a
desactivación automática.

Cada fila tiene un botón **Desactivar** o **Reactivar** según su estado actual. Al
pulsarlo se abre un panel modal que solicita obligatoriamente el **motivo** del cambio
—el cual queda registrado en la bitácora de auditoría para trazabilidad— y el botón **Confirmar**.

El cambio se procesa mediante el bus de mensajería: la pantalla te indicará que la solicitud fue aceptada y
recargará el estado de la cuenta.

> En esta tabla, la columna **Titular** muestra el **nombre** del cliente, con su
> identificador debajo. El nombre no lo guarda el servicio de cuentas —son dos
> servicios distintos y así está diseñado—, sino que la pantalla lo pide al de
> clientes en una segunda consulta. Si esa consulta no llega, la columna muestra
> solo el identificador: no es un dato faltante, es esa pregunta sin responder.

---

## 6. Transferencias

**Quién lo ve:** los tres roles. **Ruta:** `/transferencias`.

### 6.1 Enviar dinero

Botón **Nueva transferencia**. Necesitas tres datos:

| Campo | Qué escribir |
| --- | --- |
| Cuenta de origen | El número de la cuenta de la que sale el dinero. |
| Cuenta de destino | El número de la cuenta que lo recibe. **Debe ser distinta de la de origen.** |
| Monto | En quetzales, mínimo Q 0.01, máximo dos decimales. |

Hay además un campo **Escenario de pago**, marcado como *«Solo para
demostración»*. Sirve para forzar cómo termina el pago y **no existe en un banco
real**; en uso normal se deja en *«Sin escenario (comportamiento real)»*. Las
otras opciones —aprobar el pago, rechazarlo, provocar un fallo transitorio que
se reintenta, o provocar que el proveedor no responda (timeout, que sube la
misma escalera de reintentos que el fallo transitorio pero se distingue de él
en la ficha de cada intento)— están ahí para poder demostrar los cuatro finales
posibles de una transferencia sin esperar a que ocurran solos.

> [!IMPORTANT]
> **Bloqueo para clientes no verificados:** No es posible iniciar transferencias desde cuentas
> pertenecientes a clientes que no hayan completado su validación de identidad y KYC. Si un cliente
> (o un miembro del personal bancario en ventanilla) intenta transferir desde una cuenta no verificada,
> el formulario bloquea el botón de envío y muestra una alerta informativa.
>
> **Visibilidad de transferencias realizadas por ventanilla:** Cuando un cajero o administrador ejecuta
> una transferencia en ventanilla a nombre de un cliente, la operación se asocia al titular de la cuenta origen
> (`customerId`), asegurando que aparezca inmediatamente en el historial de transferencias (`/transferencias`) del cliente.
> Asimismo, en las vistas del personal bancario se muestran los nombres de los titulares origen y destino.

**La pantalla no comprueba tu saldo antes de enviar.** Esa decisión la toma el
servicio de cuentas en el momento del cobro, que es el único que puede tomarla
sin equivocarse. Si no hay fondos, la transferencia terminará en *Fallida* y el
dinero nunca habrá salido.

Al enviar, el sistema te lleva directamente a la pantalla de seguimiento.

### 6.2 Seguir una transferencia

La pantalla de la transferencia **se actualiza sola** cada dos segundos hasta
que la operación termina. Muestra el monto, la línea de tiempo con cuatro pasos
—Solicitada, Débito, Pago y el final— y el estado actual.

Una transferencia pasa por estos estados:

| Estado | Qué significa |
| --- | --- |
| **Aceptada** | El sistema recibió la solicitud y todavía no ha movido nada. |
| **Debitando** | Se pidió el cobro a la cuenta de origen. Aún no se confirma. |
| **Procesando pago** | El dinero ya salió de la cuenta de origen y el pago está en proceso. Si el pago falla, se devuelve automáticamente. |
| **Completada** | El dinero llegó a la cuenta de destino. |
| **Fallida** | La transferencia no se realizó y **el dinero nunca salió** de tu cuenta. |
| **Compensada** | La transferencia no se completó. El dinero **había salido y fue devuelto**, así que verás dos movimientos en el estado de cuenta. |

Si la transferencia no termina, la pantalla deja de consultar a los dos minutos
y te lo dice: *«Dejamos de consultar tras dos minutos. La transferencia sigue en
el sistema: no asumas que falló.»* Puedes volver a consultar cuando quieras.

**La diferencia entre Fallida y Compensada importa.** *Fallida* quiere decir que
nunca se tocó tu dinero. *Compensada* quiere decir que salió y volvió: verás dos
apuntes en el estado de cuenta y el saldo final será el mismo que antes.

### 6.3 Por qué no se completó

Cuando una transferencia termina mal, la pantalla explica el motivo en lenguaje
claro:

| Motivo | Qué pasó |
| --- | --- |
| Saldo insuficiente | La cuenta de origen no tenía suficiente dinero. |
| Cuenta inactiva | La cuenta de origen está inactiva y no se puede cobrar de ella. |
| Cuenta no encontrada | Una de las dos cuentas no existe. |
| Monto inválido | El monto debe ser mayor que cero, o tiene más de dos decimales. |
| Misma cuenta | Origen y destino son la misma cuenta. |
| Clave de idempotencia en conflicto | Esa clave ya se usó para otra transferencia distinta. Empieza una nueva en lugar de reintentar esta. |
| Pago rechazado | El pago fue rechazado. El dinero se devolvió a la cuenta de origen. |
| Pago sin respuesta tras varios intentos | El pago no se pudo procesar. El dinero se devolvió a la cuenta de origen. |

### 6.4 Consultar una transferencia anterior

En `/transferencias`, la tarjeta **Consultar una transferencia** te deja pegar el
identificador que devolvió un envío y ver su estado.

**El historial vive en `/transferencias`** y muestra tus transferencias más
recientes; si acabas de enviar una y todavía no aparece, o si solo tienes el
identificador de un comprobante, la búsqueda por `transactionId` sigue estando
en la misma pantalla. Cada quien ve las suyas: la lista la acota el servicio que
guarda las transferencias, no la pantalla.

---

## 7. Pagos

**Quién lo ve:** los tres roles. **Ruta:** `/pagos`.

Este módulo tiene dos caras, y conviene no confundirlas.

**La puerta de entrada, `/pagos`, es el pago de servicios**, y la ven los tres
roles. Ahí un Cliente paga la luz, el agua o el teléfono desde **Nuevo pago**, y
ve el historial de los servicios que ya pagó. Un pago de servicio **es una
transferencia** a la cuenta recaudadora del prestador, así que se comporta
exactamente igual que cualquier otra: los mismos estados, la misma devolución
automática si algo falla — e incluye el mismo campo **Escenario de pago**
(§6.1) para poder demostrar un rechazo, un fallo transitorio o un timeout del
proveedor pagando un servicio real, y no solo transfiriendo entre cuentas.

**El monitoreo, `/pagos/monitor`, es otra cosa** y es solo para Cajero receptor
y Administrador. Ahí «pago» no significa pagar un servicio, sino el paso
intermedio por el que pasa **toda** transferencia: después de cobrar la cuenta
de origen y antes de acreditar la de destino. Eso **no se crea desde ninguna
pantalla** — nace de una transferencia—, y el monitoreo sirve para vigilar los
que están en curso y los que terminaron mal, de todo el banco.

Un **Cliente** no entra al monitoreo, pero sí ve cómo terminó el pago de su
propia transferencia dentro de la transferencia que lo originó.

### 7.1 Monitoreo

**Quién lo ve:** Cajero receptor y Administrador. **Ruta:** `/pagos/monitor`.

La tabla lista los pagos con su identificador, la fecha, el **número de
intento**, el estado y el monto. Se puede filtrar por estado (*En proceso*,
*Aprobado*, *No completado*) y por tipo de fallo (*Transitorio*, *Permanente*),
y buscar por identificador.

Cuando hay pagos que no se completaron, un aviso rojo arriba dice cuántos fueron
por rechazo permanente y cuántos por agotar los reintentos, y recuerda que en
ambos casos **el dinero ya fue devuelto**.

### 7.2 El estado de un pago

Se llega por dos caminos: **Ver estado** en cualquier fila del monitoreo, o el
enlace al pago desde la transferencia que lo originó — que es como llega un
Cliente al pago de su propia transferencia. Un pago termina en uno de cuatro
resultados:

| Resultado | Qué significa |
| --- | --- |
| **En proceso** | Se solicitó y todavía no responde. El dinero ya salió de la cuenta de origen; si el pago no se completa, se devuelve automáticamente. |
| **Aprobado** | Se ordenó el crédito a la cuenta de destino. |
| **Rechazado** | Se rechazó y **no se vuelve a intentar**: reintentarlo daría el mismo resultado. El dinero se devolvió. |
| **Fallido** | No se completó después de agotar todos los intentos. Nadie lo rechazó; el sistema dejó de intentarlo. El dinero se devolvió y la transferencia se puede volver a hacer. |

Esta pantalla también se actualiza sola mientras el pago sigue en proceso, y
deja de consultar a los dos minutos.

### 7.3 Los intentos

La sección **Intentos** muestra la escalera de reintentos mientras se está
subiendo: en qué intento va (hasta **4**), si el último fallo fue transitorio o
permanente, y cuánto falta para el siguiente intento. Las esperas entre intentos
son de **1 segundo, 5 segundos y 30 segundos**, así que un pago con problemas
puede tardar más de medio minuto en cerrar.

La distinción entre los dos tipos de fallo es la clave para leer esta pantalla:
un **fallo transitorio** es pasajero y el sistema lo reintenta; un **rechazo
permanente** no se reintenta, porque el resultado sería el mismo.

---

## 8. Auditoría y notificaciones

**Quién lo ve:** solo el Administrador. **Ruta:** `/auditoria`.

### 8.1 Explorador general de eventos y rastro por operación

El módulo de auditoría ofrece dos vistas fundamentales para el Administrador:

1. **Bitácora general de eventos**: Permite paginar e inspeccionar los eventos registrados en el bus de mensajería (RabbitMQ) con sus metadatos (`eventId`, tipo de mensaje, productor, consumidor, severidad `INFO` / `WARNING` / `ERROR`, y estado de procesamiento) con cuerpo de payload redactado. Cada fila incluye el botón **«Ver rastro»**.
2. **Rastro de la operación seleccionada**: Al pulsar *«Ver rastro»* en cualquier evento reciente o al escribir un código de seguimiento (`correlationId`), la pantalla despliega una tarjeta destacada: **«🧭 Rastro del Evento / Operación Seleccionada»**, con el Correlation ID en cabecera, botón para **Cerrar rastro**, métricas de servicios involucrados y duración del flujo, timeline distribuido de mensajes, y el desglose de notificaciones generadas.

Cada fila muestra el momento, el tipo de evento, el servicio que lo produjo y su severidad:
- **INFO**: Operaciones habituales del sistema (ej. transferencias exitosas, apertura de cuentas, inicios de sesión).
- **WARNING**: Eventos de seguridad o cambios críticos sobre perfiles y cuentas (ej. cambio de contraseña, actualización de datos personales, activación o desactivación de cuentas). En el caso de cambio de contraseña, el sistema además envía un correo de alerta inmediata al cliente.
- **ERROR**: Fallos críticos o compensaciones monetarias (ej. `transaction.compensated.v1`, `account.debit.compensated.v1`, `payment.attempt.failed.v1` terminal).

El botón **Detalle** abre el contenido completo del evento inspeccionado.

> **Los datos sensibles no están aquí.** El contenido de los eventos se guarda ya
> oculto: los montos, los documentos y los correos aparecen como `[redactado]`.
> Esos datos viven en la base del servicio que los posee, no en la de auditoría.

Si no aparece nada, la pantalla lo explica sin adivinar: puede ser que la
operación nunca existió, que todavía está en curso, o que el servicio de
auditoria estaba caído. Si acabas de enviar la operación, espera unos segundos y
vuelve a consultar.

### 8.2 Notificaciones

Botón **Consola de notificaciones**, o la sección de notificaciones al pie del
rastro de una operación.

Lista los avisos que el sistema generó, con su estado real de entrega:
**Pendiente**, **Enviada** o **No enviada**. Se puede filtrar por estado, y
cuando alguna falló aparece un aviso rojo arriba.

El sistema avisa cuando una transferencia termina, se revierte o falla, y cuando
cambia algo de la cuenta o de la identidad de un cliente. No avisa por cada paso
interno, así que hay operaciones que no generan ninguna notificación.

> **Los envíos son simulados: de este sistema no sale ningún correo.** Una
> notificación *No enviada* no se reintenta, porque no hay un servidor de correo
> que pueda estar temporalmente caído. Que una notificación falle **no afecta la
> operación bancaria**.

---

## 9. Lo que el sistema todavía no puede hacer

Esta lista es deliberada. Son funciones que la interfaz muestra o que un usuario
esperaría, y que todavía no están disponibles. Ninguna es una avería.

Ocho de las funciones que esta lista describía ya existen: depositar en
ventanilla, ver los datos de un cliente, validar su identidad, cambiar la
contraseña, recuperarla por correo, listar transferencias, ver el historial de
pagos propio y marcar notificaciones como leídas. Lo que queda es esto.

| Lo que no se puede | Detalle |
| --- | --- |
| **Retirar efectivo** | Se puede depositar en ventanilla, pero no existe la operación inversa. El dinero sale de una cuenta únicamente mediante una transferencia o pago de servicios. |
| **Cambiar tu correo electrónico** | El correo es tu identificador de acceso principal (D-05): cambiarlo cambia con qué inicias sesión. La pantalla lo muestra de solo lectura. |
| **Confirmar el resultado de un registro o apertura en tiempo real por el cliente** | El cuentahabiente ve su estado en pantalla y en su buzón de notificaciones; el rastro forense detallado por correlación es exclusivo del Administrador. |
| **Agregar un nuevo prestador al catálogo de pagos** | Los facturadores institucionales (EEGSA, Empagua, Claro) están fijos en base de datos. Agregar nuevos convenios requiere configuración administrativa. |

El detalle técnico de cada una, con su decisión y su ticket, está en
[docs/TECH_DEBT.md](TECH_DEBT.md).

---

## 10. Preguntas frecuentes

**Me registré y no puedo iniciar sesión.**
Falta activar la cuenta. Abre el enlace de activación que llegó a tu correo. Sin
eso no se puede entrar. En una instalación local no sale ningún correo: pide el
enlace al equipo técnico.

**No me llegó el correo de activación.**
En una instalación local es lo normal: el canal de correo está simulado y el
enlace queda en el registro técnico del sistema.

**Actualicé la página y me sacó del sistema.**
Es intencional. La sesión vive solo en la memoria del navegador. Vuelve a
iniciar sesión.

**Envié una transferencia y sigue en «Procesando pago».**
El dinero ya salió de la cuenta de origen y el pago está en curso. Si el pago
falla, el sistema devuelve el dinero solo. La pantalla se actualiza sola; si
deja de hacerlo a los dos minutos, vuelve a consultar más tarde.

**Mi transferencia dice «Compensada». ¿Perdí el dinero?**
No. *Compensada* significa que el dinero salió y fue devuelto automáticamente.
En el estado de cuenta verás dos movimientos y el saldo final igual al inicial.

**Pulsé enviar dos veces. ¿Se duplicó la operación?**
No. La clave de idempotencia hace que el sistema reconozca que es el mismo
intento.

**El sistema dice «No pudimos confirmar el resultado». ¿Falló?**
No lo sabes todavía, y el sistema tampoco. La operación sigue en curso; nadie
respondió a tiempo. Guarda el identificador de correlación y vuelve a consultar.

**No veo el módulo de Auditoría.**
Es el único que se oculta por rol: solo lo ve el Administrador. **Los demás
módulos los ven los tres roles**, y lo que cambia es lo que ofrecen adentro. Si
eres Cliente y no encuentras dónde pagar un servicio, está en *Pagos → Nuevo
pago*; lo que no verás es el *monitoreo* de pagos, que muestra los de todo el
banco. Y en *Clientes* verás solo tu propia ficha, no el registro de clientes ni
la cola de validación, que son tareas de ventanilla.

**¿Dónde consigo el número de mi cuenta?**
En *Cuentas → Ver detalle*, con el botón **Copiar**. También aparece al terminar
de abrir una cuenta.

**Mi cuenta aparece como «Inactiva».**
Puede haber sido desactivada automáticamente si pasó seis meses sin movimientos con menos de Q 50.00, o por congelamiento de seguridad. Recibir una transferencia o depósito en ventanilla la reactiva automáticamente; también puedes reactivarla tú mismo desde el detalle de tu cuenta (`/cuentas/[id]`), o solicitar a un cajero o administrador que la reactive desde *Gestión de cuentas*.

---

## Ver también

- [Manual del Cliente](manual/rol-cliente.md) · [Manual del Cajero Receptor](manual/rol-cajero-receptor.md) · [Manual del Administrador](manual/rol-administrador.md)
- [Documento técnico](TECHNICAL_DOCUMENT.md) — el índice de toda la documentación del proyecto
- [Casos de uso](domain/use-cases.md) — los seis flujos del sistema, en detalle
