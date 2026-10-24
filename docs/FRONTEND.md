# Frontend

Revisión T-61, 21 de octubre de 2026. La descripción se contrasta con
`apps/web/package.json`, configuración, rutas, composables, funciones y pruebas.
La evidencia visual se registra por entorno en la
[guía de Fase III](qa/guia-validacion-manual-fase3.md).

## Stack

Nuxt 4.5.2, Vue 3.5.41, Nitro, Nuxt UI 4.10.0, Tailwind CSS 4.3.3,
TypeScript 6.0.3 y ESLint. Las versiones declaradas están en el manifiesto y
las resueltas en el lockfile. Se instala y ejecuta desde la **raíz del workspace**
con Node 24.19.0 y pnpm 11.21.0.

## Component Organization

La aplicación organiza páginas en `app/pages/` y componentes por servicio en
`app/components/{customer,account,transaction,payment,audit}/`, con elementos
compartidos en `shared/`. Nuxt deriva nombres de ruta de componentes; el nombre
de archivo debe mantener el prefijo de servicio para coincidir con su tag.

Las decisiones puras viven en `app/lib/`: dinero, permisos, validaciones,
estados, filtros y presentación de motivos. Los componentes dibujan esas
decisiones; el frontend no replica la autorización de negocio del servicio.

Los cinco módulos están implementados. Pagos es un producto visible a los tres
roles; `/pagos/monitor` y el monitor Saga son trabajo del personal. Auditoría
es el módulo restringido al Administrador. Clientes se muestra como **Usuarios**
para ese rol y conserva sus rutas. Cliente accede a sus fichas y datos propios;
el alcance se comprueba en el backend.

## Routing And State

`app/lib/navigation.ts` define Inicio y los cinco módulos, rutas públicas y
roles; `auth.global.ts` aplica navegación. Las acciones restringidas dentro de
un módulo usan funciones de permisos del módulo y controles del Gateway.

`useSession` conserva el JWT en `sessionStorage`, restaura tras recarga y
descarta valores inválidos o caducados. Cerrar sesión limpia estado y storage.
Los claims decodificados ayudan a dibujar y navegar; el Gateway valida firma.

Cada llamada pasa por `useGatewayApi`, que adjunta sesión e idempotencia cuando
corresponde, normaliza errores y gestiona expiración. En navegador HTTPS con
Gateway HTTP, usa `/api` relativo; Nitro actúa como proxy. El target es
`GATEWAY_URL` y luego `NUXT_PUBLIC_API_BASE_URL`, sin IP de producción de
reserva. El proxy retira el contexto de trazas de Cloud Run para que el Gateway
inicie la raíz que exporta.

Los comandos aceptados muestran PENDING. `useCommandOutcome` consulta auditoría
únicamente si el rol tiene acceso (TD-021); la aceptación de un comando no es
éxito de negocio. Los formularios mantienen claves para reintentos del mismo
intento. El envío interbancario genera sus identificadores en el Gateway.

## Phase III: traces, audit and interbank

`useGatewayApi` registra `X-Trace-Id` válido de respuestas exitosas y errores en
un ledger acotado por correlación (`useTraces`, `lib/trace.ts`).
`SharedCorrelationIdBadge` y `AuditEventDetail` muestran la traza y abren
Explore/Tempo si `NUXT_PUBLIC_GRAFANA_URL` está configurada. Sin esa URL quedan
como texto; sin trace-id válido no se inventa uno. Grafana tiene autenticación
independiente.

Auditoría combina por AND correlación, traza, servicio y severidad en
`GET /api/audit/recent`, con paginación de diez eventos. UUID v4 y trace-id se
validan localmente; la traza se normaliza. Los menús consultan al cambiar,
los campos de ID con Buscar. La tabla abrevia la traza y distingue un conjunto
vacío de un fallo de consulta. El detalle recibe payload redactado por el
servicio antes de persistir; no oculta datos sensibles mediante CSS.

El rastro por `GET /api/audit?correlationId=…` se consulta por separado y admite
filtros locales de productor y tipo. Las notificaciones personales y la consola
global son dos pantallas con permisos y semánticas distintos: leído/no leído
frente a resultado de entrega.

El envío interbancario valida código `BANKnn`, cuenta externa de 1–34 caracteres
alfanuméricos o guiones, y techo contractual Q 10,000.00. La configuración puede
ser más restrictiva. La lista propia usa seis estados y el detalle muestra
motivo, historial, correlación, traza y reverso. TIMEOUT conserva la reserva
mientras se reconcilia; REVERSED indica devolución. Una liberación sin confirmar
al banco externo tiene aviso específico. Estos estados no se dibujan con la
máquina Saga interna.

Los escenarios de pago se eligen explícitamente para demostración y se
identifican en las tablas. El editor global de simulación es una API
administrativa GET/PUT; no existe una pantalla para modificar sus tres
parámetros.

## The screen inventory

Se conserva el mapa de las treinta y cuatro pantallas del prototipo
`bonking.dc.html`, incluidas las variantes que comparten ruta. Fase III añade
pantallas y estados propios; presencia de una ruta y comparación visual son
evidencias distintas.

| Prototype | Screen | Route |
| --- | --- | --- |
| `P-01`–`P-01c` | Login y fallos | `/login` |
| `P-02`–`P-05` | Registro y confirmación | `/registro` |
| `P-06a`, `P-06b` | Activación | `/activar` |
| `P-07`, `P-07b` | Recuperación | `/recuperar` |
| — | Nueva contraseña | `/restablecer` |
| `C-01`–`C-01c` | Perfil y contraseña | `/perfil` |
| `C-02`, `C-02b` | Cola de identidades | `/clientes/validaciones` |
| `C-03`, `C-03b` | Documento y veredicto | `/clientes/validaciones/[id]` |
| `A-01`, `A-01b` | Dashboard Cliente | `/` |
| `A-02`, `A-02b` | Cuentas | `/cuentas` |
| `A-03`, `A-03b` | Detalle y estado | `/cuentas/[id]` |
| `A-04`–`A-04c` | Apertura | `/cuentas/nueva` |
| `A-05`–`A-05e` | Depósito en ventanilla | `/cuentas/deposito` |
| `A-06` | Gestión de cuentas | `/cuentas/administracion` |
| `T-01`, `T-02` | Transferencia y revisión | `/transferencias/nueva` |
| `T-03a`–`T-03d` | Seguimiento interno | `/transferencias/[id]` |
| `T-04`, `T-04b` | Historial interno | `/transferencias` |
| `T-05`, `T-05b` | Monitor Saga | `/transferencias/monitor` |
| — | Envío a otro banco | `/transferencias/interbancaria` |
| — | Historial interbancario | `/transferencias/interbancarias` |
| — | Detalle interbancario y reverso | `/transferencias/interbancarias/[id]` |
| `G-01`, `G-01b` | Nuevo pago | `/pagos/nuevo` |
| `G-02a`–`G-02d` | Estado de pago | `/pagos/[id]` |
| `G-03`, `G-03b` | Historial de servicios | `/pagos` |
| `G-04` | Monitoreo de pagos | `/pagos/monitor` |
| `N-01`, `N-01b` | Bandeja personal | `/notificaciones` |
| `N-02`, `N-03` | Auditoría y detalle | `/auditoria` |
| — | Consola de entregas | `/auditoria/notificaciones` |
| `D-01` | Dashboard Cajero | `/` |
| `D-02` | Dashboard Administrador | `/` |
| `X-01` | Error o recurso no disponible | `app/error.vue` |

`/` elige el dashboard según rol; no son URLs distintas. El restablecimiento
completa el flujo que el prototipo termina en «revisa tu correo».
Las desviaciones históricas están en
[TECH_DEBT](TECH_DEBT.md), sin convertir afirmaciones de tickets antiguos en
restricciones actuales.

## Styling And Accessibility

[DESIGN.md](DESIGN.md) conserva la referencia obligatoria de Claude Design,
los tokens monocromos, Inter, rejilla de 8 px y cifras tabulares. No se modifica
el sistema visual al actualizar documentación. Toda comparación visual debe
identificar pantalla, estado, viewport, entorno y referencia; una captura de
producción sola no prueba paridad con el prototipo.

Etiquetas, foco, contraste, errores adyacentes y navegación por teclado deben
verificarse. No se declara conformidad completa de accesibilidad sin evidencia
del recorrido.

## Verification

Desde la raíz:

```sh
pnpm --filter web lint
pnpm --filter web typecheck
pnpm exec turbo run test --filter=web
pnpm --filter web test:unit
pnpm --filter web test:integration
pnpm exec turbo run build --filter=web
```

`test` encadena Node test runner y Vitest. La integración de
`test/integration/*.integration.spec.ts` cruza procesos Nitro reales con
upstreams controlados, y verifica SSR, guards, proxy, pantallas de auditoría e
interbancario y propagación de identificadores. El setup compila Nuxt una vez y
gestiona servidores de prueba. No son pruebas E2E de los siete componentes ni
montajes de componentes Vue.

La antigua descripción «no hay runner» ya no aplica a la integración HTTP.
La cobertura debe expresarse por lo que cada suite ejecuta, sin atribuir
cobertura de componentes o una pasada completa de navegador a comprobaciones
estáticas. Las capturas históricas se mantienen fechadas y la validación actual
se informa en la [guía de Fase III](qa/guia-validacion-manual-fase3.md).
