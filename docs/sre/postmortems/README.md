# Postmortems

Un postmortem por incidente. Los runbooks de
[`../../operations/runbooks/`](../../operations/runbooks/README.md) dicen **qué
hacer** cuando una alerta suena; estos documentos dicen **qué pasó** una vez.

## Las reglas

1. **Blameless, y en serio.** El sujeto de un postmortem es un sistema, no una
   persona. Si la causa raíz se puede escribir como «alguien se olvidó de», está
   mal escrita: la pregunta siguiente es por qué el sistema permitía olvidarlo y
   por qué nada lo avisó. Ninguno de los de aquí tiene un nombre propio y no es
   por cortesía — es que en ninguno hacía falta.
2. **Impacto medido, no estimado.** Cada uno dice qué SLO se rompió y con qué
   número, sacado de la misma definición que usan las alertas de T-50 y los
   umbrales de `test/load/`. Si no se midió, se dice que no se midió.
3. **El dinero primero.** En un banco la pregunta no es «cuánto duró» sino «qué
   pasó con los saldos». Todos los de aquí responden eso con un recuento de
   filas, antes de hablar de latencia.
4. **Acciones con estado.** Una acción sin dueño ni ticket es una intención. Las
   que quedan abiertas salen a [`../../TECH_DEBT.md`](../../TECH_DEBT.md) con su
   número, para que no vivan sólo aquí.

## Contexto de la evidencia

Los cuatro informes de 2026-10-15 son corridas **locales de kind**, conservadas
como evidencia histórica. Sus horas originales están en UTC; convertir a
Guatemala resta seis horas, sin cambiar el instante. No se trasladan sus
resultados a producción ni se completan con una cronología inventada.

Los postmortems originales se escribieron antes de la evolución interbancaria
TD-095: el timeout de 30 s ya no describe el contrato actual de TTL 180 s y
margen adicional de 300 s. Las notas añadidas señalan esa diferencia sin
modificar la evidencia histórica.

El responsable primario de seguimiento es Infraestructura/SRE según
[OWNERSHIP](../../OWNERSHIP.md), con los dueños de servicio que indique cada
acción. Una acción antigua marcada hecha conserva su evidencia original; no
se presenta como validada de nuevo en GKE.

## Los incidentes

| Fecha | Incidente | Escenario del enunciado | Causa raíz |
| --- | --- | --- | --- |
| 2026-10-15 | [Los siete servicios se reiniciaron a la vez](2026-10-15-latido-amqp.md) | latencia o caída temporal del broker (ocurrió sola) | el latido AMQP por defecto de la librería, 5 s |
| 2026-10-15 | [El banco pareja rechaza y no contesta](2026-10-15-banco-pareja.md) | el banco pareja rechaza / no responde (**obligatorio**) | ninguna en el banco propio: 1.980 depósitos fallidos, 1.980 compensaciones, saldo intacto — y cuatro defectos de observabilidad y configuración que sólo se ven con el fallo puesto |
| 2026-10-15 | [El proveedor de pagos falla y expira](2026-10-15-proveedor-de-pagos.md) | fallos y timeouts de Payment Service (T-44) | SLO-2 y la escalera de reintentos se contradicen: el objetivo se rompe mientras el sistema hace lo correcto (TD-094) |
| 2026-10-15 | [El orquestador, eliminado a mitad de carga](2026-10-15-pod-eliminado.md) | eliminación de un pod durante la carga | ninguna: 11 s sin orquestador, 531 de 531 transferencias completas |
| 2026-10-19 | [Persistencia y permisos de cookie de RabbitMQ](2026-10-19-rabbitmq-persistence-cookie.md) | incidente descrito por cambios del broker GKE | registro parcial desde commits y manifiesto; impacto financiero y duración sin evidencia original |

Los cuatro salieron de la misma sesión de carga, la de
[T-51](../../qa/backend/T-51-load-and-failures-evidence.md), y tres de los
cuatro se inyectaron **con el mock propio y la perilla de simulación propia**:
ninguno apagó ni alteró el sistema del otro grupo, que es una regla explícita
del enunciado y no una preferencia.

## Experimentos cloud dev — 21 de octubre

| Documento | Resultado y límite |
| --- | --- |
| [Seguimiento baseline](2026-10-21-cloud-baseline-latency.md) | Umbral k6 cruzado, no equivale al histograma interno. |
| [Proveedor](2026-10-21-cloud-provider.md) | Reintentos/compensación con 30/10% inyectado; simulación restaurada. |
| [Pod Transaction](2026-10-21-cloud-pod.md) | Eliminación de un pod dev bajo carga; flujo terminal y dinero conservados. |

[Evidencia original](../../qa/backend/T-60-cloud-evidence.md). Estos tres
documentos no sustituyen el escenario obligatorio del banco externo cloud dev,
todavía sin mock/configuración; el criterio queda parcial.
