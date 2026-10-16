# Acuerdo de integración interbancaria — BANK02

> **Este documento es la fuente de la verdad de nuestro lado de la
> integración.** El banco pareja no necesita preguntarnos nada que esté aquí: lo
> que publicamos, con qué formato, con qué límites y en qué horario está escrito
> abajo, y cambia por *pull request* y no por mensaje. Si algo de aquí se
> contradice con un mensaje de chat, **manda este archivo**.

- **Contrato base**: [`../references/interbank-contract-v1.openapi.yaml`](../references/interbank-contract-v1.openapi.yaml), v1.0.0, sin modificar.
- **Nuestro banco**: `BANK02` — Bank USAC, grupo 2.
- **Última actualización**: 2026-10-16.
- **Estado**: nuestro lado definido; **esperando los datos de la pareja** (ver §2).

## 1. Lo que el contrato deja a cada pareja

El enunciado es explícito: *«los grupos no deben modificar [el contrato]; solo
acuerdan entre sí URLs, credenciales y horarios de prueba»*. Son exactamente
cuatro cosas, y las cuatro están abajo:

| Lo que se acuerda | Dónde |
| --- | --- |
| URL base de cada banco | §3 |
| API keys | §4 |
| Formato de número de cuenta y cuentas de prueba | §5 |
| Horario de pruebas | §7 |

Todo lo demás —rutas, campos, códigos, tiempos, idempotencia— lo fija el
contrato y **no se negocia**.

## 2. Los dos bancos

| | Nosotros | La pareja |
| --- | --- | --- |
| Código de banco | **`BANK02`** | `BANK__` *(pendiente)* |
| Grupo | 2 | *(pendiente)* |
| Contacto | Marcos Bonifasi · `mbonifasi@lomax.com.gt` | *(pendiente)* |
| URL base | §3 | *(pendiente)* |

**`BANK02` sale del patrón, no de una elección.** El contrato define
`BankCode` como `^BANK[0-9]{2}$` y dice que lo asigna el curso; somos el grupo 2.
Si el auxiliar asigna otro, **es un valor del ConfigMap y no un cambio de
código**: `INTERBANK_BANK_CODE`.

Lo que falta de la pareja son cuatro datos, y hasta que lleguen no se puede
probar contra ellos: su código, su URL base, su API key y sus cuentas de prueba.
Nuestro lado no los necesita para estar listo, que es el punto de este
documento.

## 3. URL base

El contrato fija el prefijo: `https://{bankHost}/interbank/v1`. Las siete
operaciones cuelgan de ahí.

| Entorno | URL base | Notas |
| --- | --- | --- |
| Producción (calificación) | `http://<IP del LoadBalancer>:3000/interbank/v1` | La IP la **reserva Terraform** (`gateway_address.tf`) y sobrevive a que se borre el `Service`, que es la razón de existir de TD-080. Se publica aquí en cuanto T-54 levante la nube. |
| Local (desarrollo) | `http://localhost:3000/interbank/v1` | Por `kubectl port-forward`; no es accesible desde fuera. |

**Sobre HTTPS.** El contrato pide «solo HTTPS» y nuestra entrada es hoy un
`LoadBalancer` de capa 4 sin terminación TLS: el certificado exigiría un dominio
y un gestor que el proyecto no tiene. Queda registrado como una **divergencia
nuestra, no del contrato** — ver §8. Si la pareja expone HTTPS, nosotros le
hablamos por HTTPS sin problema; lo que no podemos hoy es ofrecerlo.

## 4. Credenciales

Dos claves distintas, una por dirección. El contrato usa el header
`X-Api-Key` y dice que **identifica al banco que llama**.

| Clave | Quién la genera | Quién la usa | Dónde vive |
| --- | --- | --- | --- |
| La nuestra | nosotros | la pareja, al llamarnos | un `Secret` de Kubernetes, `bank-usac-secrets` |
| La suya | la pareja | nosotros, al llamarla | el mismo `Secret` |

**No se intercambian por este repositorio.** Ni aquí, ni en un issue, ni en un
commit: se mandan por un canal privado (mensaje directo) y se cargan como
variables de entorno. Una clave en un repositorio público es una clave quemada,
y este repositorio es público.

Qué sí está versionado: los **nombres** de las variables, para que no haya que
adivinarlos.

```
INTERBANK_API_KEY_INBOUND    # la que exigimos a quien nos llama
INTERBANK_API_KEY_OUTBOUND   # la que mandamos al llamar a la pareja
INTERBANK_PARTNER_BASE_URL   # su URL base, con el prefijo /interbank/v1
INTERBANK_PARTNER_BANK_CODE  # su BankCode
```

Si una clave se filtra, se rota: es un valor del `Secret` y un reinicio de los
pods. Conviene saber de antemano que **rotarla no rueda los pods por sí sola**
(TD-089), así que hace falta un `kubectl rollout restart`.

## 5. Cuentas

### 5.1 Nuestro formato de número de cuenta

El contrato define `AccountNumber` como `^[A-Za-z0-9-]{1,34}$` y dice que el
formato es «el del banco dueño de la cuenta, publicado en el acuerdo de
integración». El nuestro es:

```
02-NNNNNNNNN        p. ej.  02-000000147
```

`02` es nuestro banco y los nueve dígitos son el número de cuenta. Doce
caracteres, dentro del límite.

**Por qué no usamos nuestros UUID.** Internamente una cuenta es un UUID v4, y
fue lo primero que se intentó. **No caben**: un UUID con guiones son 36
caracteres y el contrato permite 34. Es un límite del contrato y no una
preferencia, así que el número de cuenta es un identificador propio, estable y
público, y el UUID se queda dentro.

### 5.2 Cuentas de prueba

Las cuatro que la pareja necesita para ejercitar los cuatro caminos. Se publican
aquí porque un número de cuenta no es un secreto — es lo que un cliente le dicta
por teléfono a quien le va a depositar.

| Número | Para probar | Resultado esperado |
| --- | --- | --- |
| *(se publica con T-54)* | el camino feliz | `ACCEPTED` |
| *(se publica con T-54)* | cuenta inactiva | `REJECTED` · `ACCOUNT_INACTIVE` |
| `02-999999999` | cuenta inexistente | `REJECTED` · `ACCOUNT_NOT_FOUND` |
| cualquiera, con monto > Q10 000,00 | el límite por operación | `REJECTED` · `AMOUNT_LIMIT_EXCEEDED` |

Los dos primeros se publican cuando la nube esté en pie: los números existen ya
—la secuencia los asigna al abrir cada cuenta, y en el entorno local van del
`02-000000052` al `02-000000060`— pero un número de un entorno local no le sirve
a nadie de fuera, y los de la nube serán otros.

El tercero no necesita existir, y por eso se puede publicar hoy: es un número
con el formato correcto que **no corresponde a ninguna cuenta**, que es
exactamente lo que hace falta para provocar un `ACCOUNT_NOT_FOUND`.

## 6. Límites

Los fija el contrato y los repetimos aquí para que no haya que buscarlos:

| Regla | Valor |
| --- | --- |
| Moneda | `GTQ`, única |
| Monto mínimo | `0.01` |
| Monto máximo por operación | `10000.00` → si se supera, `REJECTED` con `AMOUNT_LIMIT_EXCEEDED` |
| Formato del monto | **texto** con dos decimales, `^[0-9]{1,5}\.[0-9]{2}$` — `"150.00"`, nunca `150.0` ni `150` ni un número JSON |
| Vigencia de un depósito | `expiresAt` = `createdAt` + **180 s** |
| Margen antes de liberar una reserva sin respuesta | `expiresAt` + **300 s** |
| Reintentos del callback | espera creciente, hasta **24 h** |
| Relojes | UTC, ISO 8601, sincronizados por NTP |

El máximo es un valor del ConfigMap (`INTERBANK_MAX_AMOUNT_MINOR = 1000000`), no
una constante, porque §4.1 lo pide configurable.

## 7. Ventana de pruebas

| | |
| --- | --- |
| Propuesta | **2026-10-20 y 2026-10-21, 19:00–22:00 (UTC−6, hora de Guatemala)** |
| Confirmada por la pareja | *(pendiente)* |
| Calificación | 2026-10-24 según §7 del enunciado |

Dos días y no uno a propósito: la primera sesión de una integración se gasta en
descubrir que una URL estaba mal, y conviene que eso no pase el día antes de la
calificación.

## 8. Divergencias conocidas

Lo que hoy no cumplimos del contrato, dicho antes de que lo encuentre la pareja.
Un acuerdo que oculta esto no es un acuerdo, es una promesa.

| Qué | Por qué | Estado |
| --- | --- | --- |
| **HTTPS** | nuestra entrada es un `LoadBalancer` de capa 4 sin terminación TLS; el certificado pide un dominio que el proyecto no tiene | abierto, ver §3 |
| El resto | — | ver [`../qa/backend/T-56-interbank-reconciliation-evidence.md`](../qa/backend/T-56-interbank-reconciliation-evidence.md), que lleva el estado operación por operación |

## 9. Plan B para el día de la calificación

Si un banco no está disponible, el enunciado lo contempla y nosotros lo tenemos
preparado:

1. **Se intenta con la pareja.** Es lo que se califica.
2. **Si la pareja no responde**, se demuestra contra nuestro propio mock
   (`apps/partner-bank-mock`), que hace de **`BANK99`** —un código válido
   según el contrato y reconociblemente falso— en las dos direcciones, y se
   enciende con un valor:
   `--set partnerMock.enabled=true`. §4.1 lo permite como último recurso, y la
   regla de evaluación dice que los fallos del banco pareja no restan si el banco
   propio reacciona bien — compensando, reintentando y alertando.
3. **Si somos nosotros los que no estamos**, es nuestro problema y se ve en el
   dashboard: `08-banco-pareja.json`, las alertas `PartnerBank*` y el runbook
   [`runbooks/partner-bank.md`](runbooks/partner-bank.md).

Lo que **nunca** se hace, y conviene que las dos partes lo tengan escrito:
inyectar un fallo apagando o alterando el sistema del otro grupo. Los escenarios
de fallo se hacen con el mock propio, y los de T-51 están
[documentados](../sre/postmortems/2026-10-15-banco-pareja.md).

## 10. Cómo cambiar este documento

Por *pull request*, como todo lo demás. Si la pareja necesita que cambiemos algo
de aquí —un formato de cuenta, un horario— se discute, se decide y se escribe;
lo que no se hace es acordarlo en un chat y dejar este archivo diciendo otra
cosa. Un acuerdo que no es el archivo no es un acuerdo.
