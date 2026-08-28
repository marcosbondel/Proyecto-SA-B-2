---
name: run
description: Levanta el stack completo de Bank USAC en local, de una vez y sin pasos manuales — la infraestructura en Docker (pnpm dev:infra) y las siete aplicaciones en el host en modo watch (pnpm dev:host), lanzadas en segundo plano desde la sesión, verificadas y vigiladas — deja un monitor de errores sobre los logs que despierta al agente ante cualquier error en vivo para validarlo y reportarlo. Úsala cuando pidan correr, iniciar o levantar la aplicación para uso local o una demo. Hace toda la preparación (toolchain, install, infra sana, .env por aplicación), arranca las aplicaciones, verifica que respondan, y reporta con claridad cualquier error — Docker ausente o apagado, versiones incorrectas, dependencias que fallan, contenedores que no sanan o servicios que no arrancan.
---

Levantar el sistema completo para uso local, por la vía `dev:host` — la
infraestructura en Docker y las aplicaciones en el host, un proceso por
aplicación, con recarga en caliente. La alternativa, `pnpm dev`, corre todo en
Docker Compose; esta skill usa la vía del host a propósito.

**Esta skill lo hace todo desde la sesión, de una vez**: no entrega comandos
al usuario ni deja pasos manuales — ejecuta `pnpm dev:host` en segundo plano y
verifica que las aplicaciones realmente respondan antes de declarar el stack
arriba. El precio es que, lanzado por herramienta, `turbo run dev` no
renderiza su TUI interactiva (necesita una TTY); corre igual de bien, solo que
con logs planos que se pueden consultar desde la sesión. Al final, menciona
que si el usuario prefiere la TUI de Turborepo puede pedir que se detengan las
aplicaciones y correr `pnpm dev:host` en su propia terminal.

**Regla de reporte de errores.** En cada paso, si algo falta o falla, no lo
disimules ni improvises un rodeo: detente en cuanto el paso sea insalvable y
reporta al usuario (a) qué se detectó, (b) la salida real del comando que lo
demuestra, y (c) qué debe instalar o corregir para continuar. Los fallos
recuperables (un `pnpm install` que falta, un `.env` ausente con script
generador) se resuelven en el momento y se mencionan en el reporte final.

## Pasos

Todo se ejecuta desde la raíz del repositorio.

1. **Docker instalado y corriendo.** Primero `docker -v`: si el comando no
   existe, detente y reporta que **Docker no está instalado** — indicar
   instalar Docker Desktop (<https://docker.com/products/docker-desktop>).
   Luego `docker info`: si falla, Docker está instalado pero **el daemon no
   está corriendo** — detente y pide iniciar Docker Desktop. Nada de lo que
   sigue funciona sin él.

2. **Sin stack de aplicaciones en conflicto.** Si `docker ps` muestra
   contenedores `gateway` o `web` (el stack todo-Docker de `pnpm dev`), ocupan
   los puertos 3000/3001–3005 y 3010 que `dev:host` necesita. Ejecuta
   `pnpm dev:down` primero — detiene los contenedores de aplicación pero
   conserva la infraestructura, que el paso 4 adopta. Verifica también que
   ningún proceso del host retenga los puertos 3000 y 3010
   (`lsof -nP -iTCP:3000 -iTCP:3010 -sTCP:LISTEN`) — un `dev:host` anterior
   que quedó vivo se reporta al usuario antes de matarlo.

3. **Toolchain e instalación.** Verifica que `node -v` sea 24.19.0 y `pnpm -v`
   sea 11.21.0 (el repo fija ambos). Si alguno no coincide o no existe,
   detente y reporta la versión encontrada contra la esperada, con el remedio:
   `nvm use` para Node (o instalar nvm), `corepack enable` para pnpm. Ejecuta
   `pnpm install` si `node_modules` no existe o el lockfile cambió; si la
   instalación falla, reporta el error de dependencias tal cual salió — el
   paquete y el mensaje reales, no un resumen vago.

4. **Infraestructura, y esperar a healthy.** `infra/docker/.env` debe existir —
   si no, `cp infra/docker/.env.example infra/docker/.env` y avisa al usuario
   que revise las credenciales (los valores por defecto de desarrollo que trae
   ya levantan un stack local). Luego:

   ```bash
   pnpm dev:infra
   ```

   Sondea `docker compose -f infra/docker/docker-compose.yml ps` hasta que las
   cinco instancias de PostgreSQL, RabbitMQ y MinIO lean `healthy`. No avances
   mientras alguna siga arrancando — las aplicaciones fallarían sus primeras
   conexiones hacia la escalera de reintentos. Si tras ~2 minutos alguna sigue
   sin sanar, detente y reporta cuál, con sus últimas líneas de
   `docker logs <contenedor>`.

5. **Archivos `.env` por aplicación.** `dev:host` lee `apps/<nombre>/.env`, que
   no existen por defecto y, si faltan, hacen fallar la validación de entorno
   de cada servicio al arrancar. Genéralos (idempotente — los existentes se
   dejan intactos):

   ```bash
   bash infra/docker/scripts/write-host-env.sh
   ```

6. **Arrancar las aplicaciones.** Lanza el stack en segundo plano (con
   `run_in_background`, nunca en primer plano — no retorna):

   ```bash
   pnpm dev:host
   ```

7. **Verificar que todo respondió.** Sondea hasta que respondan el Gateway
   (`curl -sf http://localhost:3000/health`) y el frontend
   (`curl -sf -o /dev/null http://localhost:3010`), dando hasta ~90 segundos
   para el primer build en watch. Luego confirma en el log de la tarea en
   segundo plano que las siete aplicaciones arrancaron desde *este* proceso
   (cada servicio registra su «listening» y sus colas). Si algo no responde en
   el plazo, identifica qué aplicación falló y reporta el error real (variable
   de entorno faltante, puerto ocupado, dependencia rota, migración fallida…)
   con las líneas del log que lo demuestran — no declares el stack arriba si
   algo no respondió.

8. **Armar el monitor de errores.** Con el stack verificado, deja un monitor
   persistente (herramienta `Monitor`, `persistent: true`) que siga el archivo
   de salida de la tarea en segundo plano y despierte al agente ante señales
   de error en vivo:

   ```bash
   tail -n 0 -f "<archivo de salida de la tarea dev:host>" | grep -E --line-buffered '"level":"error"|"level":"fatal"|\bERROR\b|error TS[0-9]+|Found [1-9][0-9]* error|EADDRINUSE|ECONNREFUSED|UnhandledPromiseRejection|FATAL|Traceback'
   ```

   `tail -n 0` para no re-emitir el arranque ya verificado, y `--line-buffered`
   para que cada match llegue al instante. Cuando llegue una notificación:
   leer el contexto alrededor de esa línea en el archivo de salida, validar si
   es un error real o ruido, y reportarlo al usuario con las líneas del log
   que lo demuestran — no solo la línea que matcheó. El monitor y las
   aplicaciones viven lo que viva la sesión; si el usuario detiene las apps,
   detener también el monitor (TaskStop) para que no vigile un archivo muerto.

9. **Reporte final.** Con todo verificado, reporta:

   - **Frontend:** <http://localhost:3010> · **Gateway:** <http://localhost:3000>
   - **Usuarios de prueba precargados** (contraseña `BankUsac#2026`):
     `admin@bankusac.gt`, `cajero@bankusac.gt`, `cliente@bankusac.gt` (el
     cliente tiene dos cuentas, una con fondos).
   - Las aplicaciones corren en segundo plano en esta sesión; los logs se
     pueden consultar aquí mismo pidiéndolo, y el **monitor de errores** está
     activo — cualquier error en vivo se valida y se reporta sin que haya que
     pedirlo.
   - Para detener todo: pedir aquí que se detengan las apps (o cerrar la
     sesión — mueren con ella, junto con el monitor), y luego
     `pnpm dev:infra:down` para la infraestructura, que sí sobrevive a la
     sesión.
   - Si el usuario prefiere la **TUI de Turborepo** (selección de tareas con
     `↑`/`↓`, búsqueda con `/`, scroll con `u`/`d`): pedir que se detengan las
     aplicaciones y correr `pnpm dev:host` en su propia terminal (o
     `! pnpm dev:host` en esta sesión).

## Notas

- Para correr también las aplicaciones en Docker (sin toolchain en el host,
  sin `.env` por aplicación), el comando es `pnpm dev` — otro compromiso,
  cubierto en *Running It Locally* del README.
- Un subconjunto es `turbo run dev --filter=<app>` (p. ej. `--filter=gateway`),
  que arrastra los builds de sus dependencias.
- Correos de activación reales en lugar de la línea simulada en el log:
  `NOTIFICATION_CHANNEL=resend` según `docs/operations/EMAIL_RESEND.md`.
