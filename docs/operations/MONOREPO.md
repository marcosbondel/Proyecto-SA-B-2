# Estrategia de monorepo

Cómo está organizado el repositorio y cómo un cambio en un microservicio
dispara el build y el redespliegue **únicamente de ese servicio**.

## Un directorio por componente

Siete aplicaciones, cada una con lo suyo:

| Componente | Directorio | Dockerfile | Manifiestos K8s |
| --- | --- | --- | --- |
| `customer-service` | `apps/services/customer-service/` | `Dockerfile` | `k8s/` |
| `account-service` | `apps/services/account-service/` | `Dockerfile` | `k8s/` |
| `transaction-service` | `apps/services/transaction-service/` | `Dockerfile` | `k8s/` |
| `payment-service` | `apps/services/payment-service/` | `Dockerfile` | `k8s/` |
| `notification-audit-service` | `apps/services/notification-audit-service/` | `Dockerfile` | `k8s/` |
| `gateway` | `apps/gateway/` | `Dockerfile` | `k8s/` |
| `web` | `apps/web/` | `Dockerfile` | `k8s/` |

`k8s/` es un **enlace simbólico** a la carpeta de ese componente dentro del
chart (`infra/k8s/helm/bank-usac/templates/<componente>/`), donde viven su
`deployment.yaml`, su `service.yaml` y su `hpa.yaml`.

Es un enlace y no una copia a propósito. Los siete se despliegan con un solo
`helm upgrade`, porque comparten el ConfigMap, el Secret y las direcciones de
la infraestructura externa; partir eso en siete charts duplicaría esos valores
y es así como dos entornos empiezan a divergir sin que nadie lo decida. El
enlace da la vista por servicio —quien trabaja en `payment-service` encuentra
sus manifiestos en su directorio— sin que exista un segundo original que
mantener.

Los cuatro paquetes compartidos (`apps/packages/contracts`, `messaging`,
`observability`, `tooling`) no son desplegables: se consumen desde `dist/` y por eso un cambio
en ellos reconstruye los siete.

`apps/partner-bank-mock/` es una aplicación auxiliar de T-46. Prueba depósitos
entrantes y callbacks en local, con su propio Dockerfile y perfil opcional de
Compose y Deployment opcional en `templates/partner-mock/` del chart.
No es un sexto microservicio bancario: es un doble de prueba. El inventario
2026-10-21 lo muestra en prod v1.3.6 y ausente en dev. Su presencia no prueba
interoperación con un banco independiente.

## Despliegue selectivo

> **Estado.** En uso. `cd.yml` llama a `changes.yml` en cada merge a `develop`,
> construye sólo los componentes modificados y los despliega en el namespace
> `dev`. Estuvo un tiempo construido y sin que ningún workflow lo llamara —
> vivía en el despliegue a `dev`, que se retiró cuando el clúster corría un
> nodo en vez de los tres que Terraform declara (**TD-071**); con el pool en
> sus tres nodos volvió a caber, y con él volvió esto.
>
> Producción sigue desplegando la versión completa desde su tag, donde
> «selectivo» no aplica: un `vX.X.X` es una versión formal del sistema entero.

`.github/workflows/changes.yml` clasifica los archivos que cambiaron y
devuelve la lista de componentes a construir. Es un workflow reutilizable en
vez de un job copiado: la lista de rutas **es** la definición de la estrategia,
y tenerla dos veces lleva a que un servicio se despliegue desde un workflow y
no desde el otro.

```
apps/services/payment-service/**   → payment-service
apps/gateway/**                    → gateway
apps/web/**                        → web
apps/packages/**                   → los siete
pnpm-lock.yaml, turbo.json         → los siete
.github/workflows/**, .github/scripts/**, infra/k8s/helm/** → los siete
package.json, pnpm-workspace.yaml   → los siete
```

**Lo compartido dispara todo, a propósito.** Un cambio de contrato que sólo
reconstruyera el servicio que lo editó dejaría a los otros seis hablando la
versión anterior — que es precisamente el fallo que una arquitectura de
mensajes hace difícil de detectar y caro de diagnosticar.

### Selectivo en las dos mitades

Construir sólo lo que cambió es la mitad fácil: `build-development` corre una
matriz sobre los componentes modificados, y cada uno reusa su propia caché de
capas (`cache-from: type=gha,scope=<componente>`).

La otra mitad es el despliegue. `helm-deploy.sh` recibe `UPDATED_COMPONENTS` y
sólo pone la etiqueta nueva en esos; para los demás **lee la que ya tenían** con
`helm get values` y la vuelve a pasar tal cual.

Esa lectura no es un adorno. Sin conservar la etiqueta anterior, Helm podría usar
el `tag: dev` por defecto del chart — una etiqueta que no existe en el
registry — y el despliegue «selectivo» acabaría rompiendo los seis servicios
que nadie tocó. En la primera instalación no hay release del que leer, así que
todos reciben la etiqueta nueva.

Se ve en el log de cada corrida:

```
Sin cambios, conservan su etiqueta: customer-service@dev-a1b2c3 account-service@dev-a1b2c3 …
```

## Qué NO es selectivo, y por qué

**La fase de entrega publica los siete.** Un tag `vX.X.X` es una versión formal
del sistema completo: publicar sólo dos imágenes dejaría una versión que nadie
puede desplegar entera, y producción resuelve el último tag esperando
encontrarlo completo.

**El CI ejecuta las tres fases sobre todo el workspace.** Turborepo ya salta
por caché lo que no cambió (`FULL TURBO` en el log), así que el ahorro existe
sin que el pipeline tenga que decidirlo — y las pruebas de contrato son
precisamente las que deben correr cuando cambia cualquier cosa.

## Fase III — bibliotecas y chart de observabilidad

`apps/packages/observability` es la cuarta biblioteca compartida, junto a
contracts, messaging y tooling. Sus consumidores son los seis procesos
NestJS; la dependencia forma parte del grafo de Turborepo y de los filtros de
reconstrucción. Los cambios de telemetría también deben contrastarse con el
[catálogo](../sre/telemetry-catalog.md), el chart `bank-observability` y sus
nueve dashboards. `partner-bank-mock` es auxiliar y no eleva a ocho el número
de aplicaciones bancarias. La publicación/deploy efectivo se gobierna por
los filtros de `.github/workflows/changes.yml` y [CI.md](CI.md).

## Límite de la selección y componentes auxiliares

La lista anterior transcribe `changes.yml`: no equivale a todos los archivos de
`infra/k8s/` ni al directorio del mock. Cambios sólo en documentación no
construyen aplicaciones. El stack `bank-observability` tiene un release y un
ciclo de vida propios; no se duplica por entorno.

Las siete aplicaciones son la matriz bancaria; el mock tiene su Dockerfile y
ruta de despliegue auxiliar. Verificar sus condiciones de build/tag en
`release.yml` y `cd.yml` antes de asumir que el filtro bancario cubre cualquier
cambio de `apps/partner-bank-mock/`. Una publicación `v*` y un rollout Ready
requieren todavía comprobar versión efectiva, configuración y flujos.
