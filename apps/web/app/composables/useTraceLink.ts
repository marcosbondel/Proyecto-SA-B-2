import { grafanaTraceUrl } from '../lib/grafana';

/**
 * Dónde abrir una traza, si el despliegue sabe dónde está Grafana (T-60).
 *
 * Lee `NUXT_PUBLIC_GRAFANA_URL` de la configuración pública —como la dirección
 * del Gateway, se resuelve al arrancar y no se compila— y devuelve una función
 * que, para un `traceId`, da la dirección de Explore sobre Tempo o `null`. El
 * `null` es el caso normal en local sin Grafana y en cualquier despliegue que
 * no lo configure: quien llama debe seguir mostrando el texto copiable.
 */
export function useTraceLink() {
  const config = useRuntimeConfig();

  return (traceId: string | null | undefined): string | null =>
    grafanaTraceUrl(config.public.grafanaUrl, traceId);
}
