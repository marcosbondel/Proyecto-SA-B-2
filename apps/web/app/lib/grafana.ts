/**
 * El enlace de un `traceId` a Grafana (T-60, sección D).
 *
 * La interfaz ya enseñaba el identificador de la traza para que alguien lo
 * copiara y lo pegara en Grafana. Si el despliegue sabe dónde está Grafana, el
 * camino corto es un enlace que abre Explore ya posicionado en esa traza.
 *
 * **Es opcional y no inventa nada.** Sin `NUXT_PUBLIC_GRAFANA_URL` (o con un
 * valor que no es un origen http/https) esta función devuelve `null` y la
 * pantalla se queda con el texto copiable de siempre. Y sólo un `traceId` que
 * es un identificador W3C de verdad llega a la dirección: lo que sale de aquí
 * termina en un `href`, y un valor que no pasó por la misma comprobación que
 * `lib/trace.ts` aplica a la cabecera no debería poder construir una URL.
 *
 * Una función pura, por lo mismo que todo lo que decide en `app/lib/` (TD-010).
 */

/** El `uid` del datasource de Tempo que el chart `bank-observability` provisiona. */
export const TEMPO_DATASOURCE_UID = 'bank-tempo';

/**
 * Cuánto atrás mira Explore. Tempo retiene siete días, así que una ventana de
 * siete días es la más corta que no esconde una traza que todavía existe.
 */
export const TRACE_LOOKBACK = 'now-7d';

const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

/**
 * El origen de Grafana, o `null`.
 *
 * Se conserva la ruta (Grafana puede servirse bajo un prefijo) pero no una
 * barra final, para que unir no dé `//explore`. Un esquema distinto de
 * http/https se descarta: un `javascript:` en una variable de entorno no debe
 * poder acabar en un `href`.
 */
export function grafanaBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

/**
 * Explore sobre Tempo, ya buscando esta traza, o `null` si no hay Grafana
 * configurado o el identificador no es una traza.
 */
export function grafanaTraceUrl(
  grafanaUrl: unknown,
  traceId: string | null | undefined,
): string | null {
  const base = grafanaBase(grafanaUrl);
  const trace = traceId?.trim().toLowerCase();

  if (base === null || trace === undefined || !TRACE_ID.test(trace)) {
    return null;
  }

  const panes = {
    a: {
      datasource: TEMPO_DATASOURCE_UID,
      queries: [
        {
          refId: 'A',
          datasource: { type: 'tempo', uid: TEMPO_DATASOURCE_UID },
          queryType: 'traceql',
          query: trace,
        },
      ],
      range: { from: TRACE_LOOKBACK, to: 'now' },
    },
  };

  return `${base}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify(panes))}&orgId=1`;
}
