# Envío de correos reales con Resend

Por defecto Bank USAC **no envía correos**: el canal es `simulated` y el enlace de
activación se escribe en el log (§4.1 del enunciado, y es lo que lee
`pnpm images:flow`). Este documento explica cómo activar el envío **real** del
correo de activación a través de [Resend](https://resend.com), verificando un
dominio alojado en **AWS Route 53**.

Solo el **correo de activación** se envía de verdad: es la única notificación
cuyo evento transporta una dirección real (`customer.activation.requested.v1`,
excepción M-5 del contrato). Las demás notificaciones no llevan dirección real
por diseño y siguen simuladas. La dirección real se usa solo para enviar y
**nunca se almacena** — la base de auditoría sigue guardando la dirección
simulada.

## Qué implementa el código

- `NOTIFICATION_CHANNEL=resend` selecciona el adaptador
  `ResendNotificationAdapter`, que envía por la API REST de Resend.
- El adaptador **nunca lanza**: una entrega fallida es un estado `FAILED` en una
  fila que alguien puede ver, no una excepción que reintente en vano.
- El token nunca se registra: solo se registra el `id` que devuelve Resend.
- El enlace se vuelve absoluto anteponiendo `APP_BASE_URL` al path `/activar?token=…`.

## Variables de entorno

| Variable | Requerida | Ejemplo | Nota |
| --- | --- | --- | --- |
| `NOTIFICATION_CHANNEL` | sí | `resend` | `simulated` (default) no envía nada |
| `RESEND_API_KEY` | con `resend` | `re_xxxxxxxx` | Clave de Resend. Nunca se registra ni se commitea |
| `EMAIL_FROM` | con `resend` | `bonking <no-reply@mail.tudominio.com>` | El dominio debe estar verificado en Resend |
| `APP_BASE_URL` | con `resend` | `https://app.tudominio.com` | Origen del frontend, para el enlace absoluto |
| `RESEND_API_URL` | no | `https://api.resend.com/emails` | Default; solo se cambia en pruebas |
| `REVEAL_ACTIVATION_LINKS` | no | `false` | Ponlo en `false`: el enlace va al inbox, no al log |

## Paso a paso

### 1. Crear la cuenta y agregar el dominio en Resend

1. Entra a <https://resend.com> y crea la cuenta / inicia sesión.
2. **Domains → Add Domain.** Escribe un **subdominio de envío**, recomendado
   `mail.tudominio.com` (Resend aconseja un subdominio, así el dominio raíz
   conserva su propia reputación de correo). Elige la región más cercana
   (p. ej. `us-east-1`).
3. Resend te mostrará una lista de **registros DNS** que debes crear. Suelen ser:
   - un **MX** (para rebotes) sobre el subdomino de envío,
   - un **TXT de SPF** (`v=spf1 include:amazonses.com ~all`),
   - uno o varios registros **DKIM** (TXT o CNAME, con un valor `p=…` largo),
   - opcionalmente un **TXT de DMARC** sobre `_dmarc`.

   > Copia los valores **exactos** que te muestra Resend: el nombre del registro
   > DKIM y su valor son únicos de tu dominio. No los inventes ni los copies de
   > este documento.

### 2. Crear los registros en Route 53

1. AWS Console → **Route 53 → Hosted zones →** tu dominio.
2. Por cada registro que Resend pide, **Create record**:
   - **Record name:** solo la parte relativa. Si Resend muestra
     `mail.tudominio.com`, en Route 53 escribes `mail` (la zona ya es
     `tudominio.com`). Para `resend._domainkey.tudominio.com`, escribes
     `resend._domainkey`.
   - **Record type:** el que indique Resend (`MX`, `TXT` o `CNAME`).
   - **Value:**
     - `TXT`: pega el valor **entre comillas dobles**, p. ej.
       `"v=spf1 include:amazonses.com ~all"`. Si un valor DKIM es muy largo
       (>255 caracteres), Route 53 lo acepta partido en varias cadenas entre
       comillas — pégalo tal cual lo da Resend.
     - `MX`: formato `10 feedback-smtp.us-east-1.amazonses.com` (prioridad y host).
     - `CNAME`: el destino que da Resend, sin comillas.
   - **TTL:** 300 está bien.
3. Guarda cada registro. Route 53 propaga en segundos a pocos minutos.

### 3. Verificar en Resend

1. Vuelve a Resend → tu dominio → **Verify DNS Records**.
2. Espera a que todos pasen a **Verified** (normalmente minutos; puede tardar
   hasta ~1 hora). Mientras no esté verificado, Resend solo deja enviar a la
   dirección dueña de la cuenta.

### 4. Crear la API key

1. Resend → **API Keys → Create API Key.**
2. Permiso **Sending access**, dale un nombre (p. ej. `bank-usac-prod`).
3. Copia el valor `re_…` **en ese momento** (solo se muestra una vez).

### 5. Configurar el servicio

En `infra/docker/.env` (nunca en el repo), para el stack de imágenes o de dev:

```dotenv
NOTIFICATION_CHANNEL=resend
RESEND_API_KEY=re_tu_clave
EMAIL_FROM=bonking <no-reply@mail.tudominio.com>
APP_BASE_URL=https://app.tudominio.com
REVEAL_ACTIVATION_LINKS=false
```

- `EMAIL_FROM` debe usar el dominio verificado (si verificaste
  `mail.tudominio.com`, la dirección va `@mail.tudominio.com`).
- `APP_BASE_URL` es donde corre el frontend. Para una prueba local con el correo
  real, puedes dejar `http://localhost:3010` — el enlace del correo abrirá tu
  frontend local.

Reinicia el servicio para que tome la configuración:

```bash
docker compose -f infra/docker/docker-compose.images.yml up -d notification-audit-service
# o, en dev:  pnpm dev
```

### 6. Probar

1. Registra un cliente con un **correo real que controles**.
2. Debe llegar el correo de activación remitido desde tu `EMAIL_FROM`, con el
   botón "Activar mi cuenta" apuntando a `APP_BASE_URL/activar?token=…`.
3. Si no llega:
   - Revisa el log del servicio: un `outcome: FAILED` con `providerStatus` o
     `providerError` dice qué respondió Resend (dominio no verificado, `from`
     fuera del dominio, clave inválida).
   - Revisa **spam** y el panel **Emails** de Resend (registra cada envío).

## Prueba rápida sin dominio (opcional)

Para verificar el cableado antes de terminar el DNS, Resend permite enviar desde
`onboarding@resend.dev` **solo a la dirección dueña de tu cuenta**:

```dotenv
NOTIFICATION_CHANNEL=resend
RESEND_API_KEY=re_tu_clave
EMAIL_FROM=bonking <onboarding@resend.dev>
APP_BASE_URL=http://localhost:3010
```

Registra un cliente con el correo de tu cuenta de Resend y confirma que llega.
Luego cambia a tu dominio verificado para poder enviar a cualquiera.

## En Kubernetes (chart de Helm)

El chart cablea las cuatro variables al pod de `notification-audit-service`
**siempre**, tanto en `simulated` como en `resend`. Es seguro porque el servicio
solo lee `RESEND_API_KEY`, `EMAIL_FROM` y `APP_BASE_URL` en la rama `resend`; con
el canal por defecto llegan vacías y sin usar. Cablearlas condicionalmente
significaría que el `helm upgrade` que gira el canal también tendría que agregar
tres variables, y un pod que arranca sin ellas entra en `CrashLoopBackOff` por
validación de entorno en lugar de decir qué falta.

La clave vive en el Secret (`secrets.resendApiKey`) y el resto en el ConfigMap
(`services.notificationAudit.resend.*`). Pásalos en la instalación:

```sh
helm upgrade --install bank-usac infra/k8s/helm/bank-usac \
  --namespace bank-usac --create-namespace \
  -f infra/k8s/kind/generated-external.values.yaml \
  --set services.notificationAudit.notificationChannel=resend \
  --set secrets.resendApiKey=re_tu_clave \
  --set 'services.notificationAudit.resend.emailFrom=bonking <no-reply@mail.tudominio.com>' \
  --set services.notificationAudit.resend.appBaseUrl=https://app.tudominio.com \
  --set services.notificationAudit.revealActivationLinks=false
  # ...y los demás valores que templates/secret.yaml marca como requeridos.
```

Dos cosas que el chart hace para que esto no falle en silencio:

- **Falla al renderizar, no en ejecución.** Con el canal en `resend` y cualquiera
  de los tres valores vacío, `helm` se niega a renderizar y nombra el que falta —
  el mismo contrato que `templates/secret.yaml` da a las contraseñas de base de
  datos. Es preferible a un pod que arranca y descubre el problema al primer
  correo.
- **El pod se reinicia al cambiar la configuración.** El deployment lleva
  anotaciones `checksum/config` y `checksum/secret`. Sin ellas, un `helm upgrade`
  que gire el canal a `resend` dejaría el pod corriendo con el entorno anterior
  y no enviaría nada: toda la configuración llega por `configMapKeyRef` y
  `secretKeyRef`, cuyos *nombres de clave* no cambian, así que el pod spec sería
  idéntico y no habría despliegue nuevo.

`RESEND_API_URL` no se pasa: `values.yaml` ya trae el endpoint real por defecto y
el ConfigMap lo respalda con `default`, porque se valida como URL en **cada**
arranque —incluido el canal simulado— y un valor vacío tumbaría un pod que no
envía ningún correo.

## Notas de seguridad

- La `RESEND_API_KEY` es un secreto: va en `.env` (git-ignored) o en un secreto
  de Kubernetes/Helm, nunca en un `values.yaml` committeado ni en una imagen.
- El correo de activación lleva un token de un solo uso; por eso el enlace nunca
  se registra en el log cuando el canal es real, y `REVEAL_ACTIVATION_LINKS`
  debe estar en `false`.
