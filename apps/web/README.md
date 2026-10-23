# `apps/web` — frontend de Bank USAC

Aplicación Nuxt 4 con los cinco módulos y las extensiones de Fase III:
seguimiento interbancario, auditoría filtrada e identificadores enlazables a
Grafana. La arquitectura, rutas y convenciones están en
[FRONTEND](../../docs/FRONTEND.md); las instrucciones de uso, en el
[manual](../../docs/manual-usuario.md).

## Ejecutar

Desde la raíz del repositorio, con Node 24.19.0 y pnpm 11.21.0:

```sh
pnpm install
pnpm exec turbo run dev --filter=web
```

El script fija el puerto **3010**. El Gateway ocupa 3000. Para el sistema
completo usa `pnpm dev` o el par `pnpm dev:infra` y `pnpm dev:host`, según el
[runbook de contenedores](../../docs/operations/CONTAINERS.md).

Copia `apps/web/.env.example` a `apps/web/.env` y configura:

| Variable | Función |
| --- | --- |
| `NUXT_PUBLIC_API_BASE_URL` | Origen del Gateway, público y leído en runtime. |
| `GATEWAY_URL` | Override solo servidor del destino del proxy Nitro. |
| `NUXT_PUBLIC_GRAFANA_URL` | Opcional; permite abrir trace-id en Explore/Tempo. |

En navegador HTTPS con API HTTP, el cliente usa `/api` relativo y Nitro
reenvía al Gateway, evitando contenido mixto. El proxy toma `GATEWAY_URL` o
la URL pública; no tiene una IP de producción de reserva. Nunca incluyas
secretos en variables `NUXT_PUBLIC_*`.

`/health` informa vida del proceso, `/ready` configuración y `/metrics`
expone las métricas de Nitro. Una sonda web sana no confirma que la API bancaria
responda.

## Convenciones

- Páginas en `app/pages/`, componentes por servicio y elementos compartidos.
- Reglas y validaciones puras en `app/lib/`.
- Llamadas mediante `useGatewayApi`; `202` muestra aceptación pendiente.
- JWT en `sessionStorage`; una recarga lo restaura si sigue vigente.
- Autorización efectiva en Gateway/servicios, además de la navegación por rol.
- Correlación y traza válidas se muestran sin inventar valores ausentes.
- Dinero como unidades menores en la interfaz HTTP y formato GTQ al dibujar.
- Estilo y referencia obligatoria en [DESIGN](../../docs/DESIGN.md).

## Verificar

```sh
pnpm --filter web lint
pnpm --filter web typecheck
pnpm exec turbo run test --filter=web
pnpm --filter web test:unit
pnpm --filter web test:integration
pnpm exec turbo run build --filter=web
```

`test` ejecuta las dos suites: Node test runner para funciones/comprobaciones
estáticas y Vitest para integración HTTP con Nitro real y upstreams controlados.
La integración compila Nuxt y gestiona sus procesos de prueba. Cubre SSR, guards,
proxy y pantallas/identificadores de Fase III según sus casos concretos.

No se atribuye a esas suites cobertura de componentes montados ni E2E de las
siete aplicaciones. La comprobación de navegador y sus capturas se registran en
la [guía de Fase III](../../docs/qa/guia-validacion-manual-fase3.md).
