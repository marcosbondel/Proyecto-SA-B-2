# Acuerdo de integración interbancaria — dónde vive

> **El acuerdo no está aquí.** Es
> [`AGREEMENT.md` de `bank-interbank-contract`](https://github.com/marcosbondel/bank-interbank-contract/blob/main/AGREEMENT.md),
> y el contrato del curso que lo gobierna está
> [junto a él](https://github.com/marcosbondel/bank-interbank-contract/tree/main/openapi/course-base).

## Por qué allá y no acá

Porque un acuerdo tiene **dos partes**, y este repositorio sólo es de una.

`bank-interbank-contract` es público, lo consultan los dos grupos, y cada cambio
necesita la aprobación de un integrante de cada banco en un *pull request*. Un
acuerdo que uno de los dos puede cambiar solo no es un acuerdo, y un acuerdo que la
pareja tiene que buscar dentro de nuestro monorepo tampoco lo es.

Esta página existió unas horas como una copia completa del acuerdo, y fue un error:
dos copias de un acuerdo divergen, y el día que discrepen nadie sabrá cuál manda —
que es exactamente lo que el propio documento advierte en su §11. Se redujo a este
puntero el 2026-10-16.

## Qué hay allá y qué hay acá

| | |
| --- | --- |
| **El contrato del curso**, sin modificar, con su SHA-256 verificado en CI | [`openapi/course-base/`](https://github.com/marcosbondel/bank-interbank-contract/tree/main/openapi/course-base) |
| **El acuerdo**: códigos de banco, URLs, cómo se intercambian las API keys, formato de cuenta, cuentas de prueba, tiempos, ventana de pruebas, divergencias declaradas | [`AGREEMENT.md`](https://github.com/marcosbondel/bank-interbank-contract/blob/main/AGREEMENT.md) |
| **Ejemplos** de los once esquemas, válidos e inválidos, validados en CI | [`examples/`](https://github.com/marcosbondel/bank-interbank-contract/tree/main/examples) |
| **Un mock** del banco pareja que sirve el contrato | `npm run mock` allá |
| **Cómo lo implementamos nosotros**, y qué falta | [`../qa/backend/T-56-interbank-reconciliation-evidence.md`](../qa/backend/T-56-interbank-reconciliation-evidence.md) |
| **El flujo interno**: los estados del depósito recibido, los mensajes del broker, la configuración | [`INTERBANK.md`](INTERBANK.md) |

La línea es ésa: **allá, lo que las dos partes acuerdan; acá, lo que nosotros
construimos**. Nuestro código de banco es `BANK02` y nuestro formato de cuenta es
`02-NNNNNNNNN`, pero los dos están allá porque son datos que la pareja necesita y no
decisiones que podamos cambiar solos.

## Lo único que conviene repetir acá

Porque afecta a quien despliegue esto y no leerá el otro repositorio:

- **Las API keys no van en ningún repositorio**, ni en éste ni en aquél. Llegan por un
  canal privado y se cargan en el `Secret` de Kubernetes. Los nombres de las variables
  sí están versionados (`INTERBANK_API_KEY_INBOUND`, `INTERBANK_API_KEY_OUTBOUND`), que
  es lo que evita tener que adivinarlos.
- **Rotar una clave no rueda los pods**: hace falta un `kubectl rollout restart`
  después (TD-089).
- **Tenemos dos divergencias declaradas** con el contrato, y están en §13 del acuerdo:
  HTTPS, y el protocolo de `TIMEOUT` del lado emisor
  ([TD-095](../TECH_DEBT.md)). La segunda puede costar dinero real, así que conviene
  leerla antes de una prueba conjunta.
