# T-58 — Catálogo de telemetría y los SLO medibles: evidencia

Fecha: **2026-10-14**. Rama `feature/T-58`.

Lo que este ticket entrega es documentación y dos barreras ejecutables. La
evidencia, por tanto, es doble: lo que dice el catálogo, y la comprobación de
que lo que dice **es verdad contra un Prometheus real**.

## 1. El catálogo existe y es cerrado

[`docs/sre/telemetry-catalog.md`](../../sre/telemetry-catalog.md) inventaría las
**veintitrés señales** que el sistema emite hoy —cuatro de mensajería, dos de
HTTP, tres de Customer, dos de Account, tres de Transaction, tres de Payment,
tres de interbancario entrante y tres de auditoría— más las de infraestructura
que no son de la aplicación (consumer lag, cAdvisor, `kube-state-metrics`) y
**dos nombres reservados** para el envío interbancario de T-47.

Cada fila lleva tipo, unidad, etiquetas permitidas, su nombre en Prometheus y la
justificación de cardinalidad. Añade también los nombres de span y los campos de
log, que el enunciado pide definir en el mismo paso (§6, Paso 2).

## 2. La cardinalidad es una prueba, no una promesa

`apps/packages/observability/test/metric-cardinality.spec.ts` barre el código de
los siete componentes, extrae las claves de atributo de cada `.add(` y
`.record(`, y falla si aparece una que el catálogo no declare o que tenga forma
de identificador.

```
$ pnpm --filter @bank/observability exec jest
Test Suites: 4 passed, 4 total
Tests:       65 passed, 65 total
```

Las etiquetas que el barrido encuentra hoy, por archivo, son exactamente las del
catálogo:

| Archivo | Etiquetas |
| --- | --- |
| `otel-activity.telemetry.ts` | `account_type`, `operation`, `rule` |
| `otel-transfer.telemetry.ts` | `result`, `reason` |
| `otel-audit.telemetry.ts` | `family`, `severity`, `outcome`, `processing`, `result`, `status` |
| `otel-provider.telemetry.ts` | `result`, `source`, `action` |
| `otel-interbank.telemetry.ts` | `result` |
| `otel-lifecycle.telemetry.ts` | `reason`, `result`, `path` |
| `messaging/src/telemetry.ts` | `messaging.system`, `messaging.operation.name`, `messaging.destination.name`, `bank.delivery.outcome`, `error.type` |

El denegador se probó en los dos sentidos: detecta `account_id`, `accountId`,
`bank.account.id`, `customerId`, `transfer_id`, `correlationId`, `id`,
`traceId`, `bank.correlation_id` y `message.id`, y no marca ninguna de las
diecisiete etiquetas legítimas.

## 3. Los SLO medibles, con su consulta

[`sli-slo-sla.md` §5.3](../../sre/sli-slo-sla.md#53-los-slo-que-la-fase-3-mide-con-datos-reales-t-58)
nombra los **cinco** que esta fase mide con datos reales —SLO-27 (nuevo,
disponibilidad del Gateway), SLO-2, SLO-1, SLO-6/7 y SLO-28 (nuevo, el banco
pareja)— cada uno con su PromQL, su ventana, su error budget y el umbral de
*burn rate* justificado. Los veintiséis restantes quedan marcados como
documentales **con el motivo**, agrupados por qué los demuestra en su lugar.

Dos decisiones que el documento razona y conviene no perder:

- **La ventana pasa de mensual a 7 días corridos.** La retención del stack es de
  7 días por coste; un SLO de ventana mensual no se puede calcular con datos que
  no existen.
- **SLO-27 es nuevo porque faltaba el objetivo, no el indicador.** SLI-1 define
  la disponibilidad como `código < 500` desde la Fase 1 y ninguno de los treinta
  SLO estaba ligado a él.

## 4. Lo que la corrida real encontró (y por lo que este ticket valió la pena)

`pnpm obs:kind` levanta el stack completo en un kind desechable. Verificaba
siete cosas y ninguna preguntaba **el nombre de una serie**. Se añadieron la 8 y
la 9, y la primera corrida fue roja:

```
8. Prometheus tiene las series con el nombre del catalogo
   FALLO: el contador no existe con _total. Revisa add_metric_suffixes
```

**Causa raíz.** El exportador del Collector estaba con
`add_metric_suffixes: false`, justificado en un comentario con que el nombre ya
traía la unidad y el sufijo produciría `..._seconds_seconds`. No es así: el
sufijo sale del campo `unit` del instrumento (`s`), no del nombre. El efecto era
que las series se llamaban `bank_transfer_finished` y `bank_transfer_duration`,
mientras **todas** las consultas ya escritas en `docs/sre/` (anexos de T-43,
T-44, T-45 y T-48) usan `_total` y `_seconds`. T-50 habría construido los ocho
dashboards sobre series vacías.

La misma corrida encontró un segundo defecto, de un día de antigüedad: las
comprobaciones 3, 4 y 5 preguntaban por `{service_name="fake-bank-service"}`, el
nombre del `Deployment`, cuando `57e99fc` hizo —correctamente— que
`service.name` salga del campo `serviceName` de la propia línea. El stream se
llama `transaction-service`. Nadie volvió a correr el script después de ese
arreglo, así que la afirmación "7 de 7" de `CLOUD.md` no reproducía.

Tras arreglar las tres consultas y hacer que `--verify` vuelva a empujar la
telemetría (el exportador olvida una serie que no se vuelve a reportar a los
cinco minutos, lo que daba un falso rojo en la 8):

```
$ ./infra/scripts/cloud/obs-kind.sh --verify
    1. Tempo tiene la traza                                        OK
    2. Loki indexa SOLO las etiquetas de la lista cerrada           OK
    3. El JSON del banco se parseo: filtrar por traceId             OK
    4. correlationId tambien es consultable                         OK
    5. La linea que NO es JSON se guardo igual                      OK
    6. Prometheus raspa al Collector                                OK
    7. Grafana cargo los tres datasources y los derivedFields       OK
    8. Prometheus tiene las series con el nombre del catalogo
       OK  bank_transfer_finished_total
       OK  bank_transfer_duration_seconds_bucket
    9. Las dos etiquetas del catalogo estan, y ninguna mas
       OK  service_name y environment
       OK  k8s_pod_name NO es etiqueta

    RESULTADO: 9 de 9. El stack mide lo que dice medir.
```

Eso cierra el criterio de aceptación que pedía comprobar que **cada SLI elegido
tiene una serie que lo alimenta**, sin gastar un centavo en la nube.

## 5. Validación

| Comando | Resultado |
| --- | --- |
| `pnpm lint` | 14 de 14 |
| `pnpm --filter @bank/observability exec tsc --noEmit` | sin errores |
| `pnpm --filter @bank/observability exec jest` | 65 casos, 4 suites |
| `pnpm obs:lint` | 1 chart, 0 fallos |
| `pnpm obs:template` | renderiza con `add_metric_suffixes: true` |
| `./infra/scripts/cloud/obs-kind.sh` | 9 de 9 sobre kind |
| `bash -n infra/scripts/cloud/obs-kind.sh` | sintaxis válida (bash 3.2, el de macOS) |

## 6. Lo que queda abierto

- La disponibilidad del Gateway (SLO-27) se verificó en la **forma** de la serie
  (`http.server.request.duration` existe en `instrumentation-http` 0.223.0 y es
  la convención semántica estable), no con tráfico real del Gateway: eso llega
  con T-54, cuando haya un Gateway en pie recibiendo peticiones.
- SLO-28 mide hoy sólo la dirección entrante. La saliente son los dos nombres
  reservados, que T-47 debe usar tal cual.
- Los nombres de las series de RabbitMQ para el consumer lag son del plugin, no
  nuestros: T-50 debe confirmarlos en kind antes de escribir su *recording
  rule*, como dice el catálogo §2.9.
