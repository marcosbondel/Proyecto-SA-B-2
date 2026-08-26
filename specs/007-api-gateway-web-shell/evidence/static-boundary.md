# Criterio 4 — el Gateway no tiene base de datos ni clientes HTTP internos

Búsqueda estática del 2026-08-24T19:23:48Z. Cada bloque debe salir vacío.

## Credenciales o clientes de base de datos
```
$ grep -rEn "DATABASE_URL|postgres://|typeorm|prisma|from .pg.|knex|Sequelize" apps/gateway/src
apps/gateway/src/infrastructure/config/environment.ts:38: * The gateway declares no `DATABASE_URL`: it never reads a database

$ grep -E "\"(pg|typeorm|prisma|mysql2|knex|sequelize|mongoose)\"" apps/gateway/package.json
(sin resultados)

$ grep -E "^DATABASE_URL=" apps/gateway/.env.example
(sin resultados)
```

> La única coincidencia textual de `DATABASE_URL` en el repositorio del Gateway
> es el comentario que **explica su ausencia**, en `infrastructure/config/environment.ts`
> y en `.env.example`. La prueba `no-database-no-http.spec.ts` elimina comentarios
> antes de buscar, precisamente para que ese comentario pueda quedarse.

## Clientes HTTP hacia servicios internos
```
$ grep -rEn "from 'axios'|from 'node-fetch'|from 'got'|@nestjs/axios|HttpModule|HttpService" apps/gateway/src
(sin resultados)

$ grep -rEn "https?://[^\"]*(customer|account|transaction|payment|notification)[a-z-]*service" apps/gateway/src
(sin resultados)

$ grep -E "\"(axios|@nestjs/axios|node-fetch|got|superagent|undici)\"" apps/gateway/package.json
(sin resultados)
```

## Lo que sí está, y por qué es correcto

```
apps/gateway/package.json:    "@aws-sdk/client-s3": "catalog:",
apps/packages/messaging/package.json:    "amqp-connection-manager": "catalog:",
apps/packages/messaging/package.json:    "amqplib": "catalog:"
```

`@aws-sdk/client-s3` es el almacenamiento de objetos de ADR-012 — un búfer de
transferencia, no una base: nadie lo consulta para decidir nada y el dueño de la
foto sigue siendo Customer Service. El broker es la única vía hacia los cinco
servicios, que es lo que exige la constitución IV.

## Automatizado

Estas mismas búsquedas corren en `apps/gateway/test/no-database-no-http.spec.ts`
(21 aserciones) dentro de `pnpm test`, así que una violación futura falla la
suite en vez de esperar a que alguien repita este grep.
