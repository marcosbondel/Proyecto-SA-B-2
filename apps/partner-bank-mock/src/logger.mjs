/**
 * Una línea de JSON por evento, en stdout: el mismo formato que el resto del
 * sistema (`timestamp`, `level`, `serviceName`, `traceId`, `spanId`…), para que
 * el agente de logs lo recoja igual y se pueda buscar por `traceId` en Loki.
 *
 * Qué NO se escribe, nunca: una API key, el token de administración ni el valor
 * de ningún header de autenticación. Los eventos nombran campos concretos en
 * lugar de volcar la petición, que es la única forma fiable de no filtrar algo
 * que alguien añade a la petición mañana.
 */
const SERVICE_NAME = 'partner-bank-mock';

export function createLogger({
  sink = (line) => process.stdout.write(`${line}\n`),
  now = () => new Date(),
} = {}) {
  function write(level, event, fields) {
    sink(
      JSON.stringify({
        timestamp: now().toISOString(),
        level,
        serviceName: SERVICE_NAME,
        environment: process.env.DEPLOYMENT_ENVIRONMENT,
        version: process.env.SERVICE_VERSION,
        event,
        ...fields,
      }),
    );
  }
  return {
    info: (event, fields = {}) => write('info', event, fields),
    warn: (event, fields = {}) => write('warn', event, fields),
    error: (event, fields = {}) => write('error', event, fields),
  };
}
