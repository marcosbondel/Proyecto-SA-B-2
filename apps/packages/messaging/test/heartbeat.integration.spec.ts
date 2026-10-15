import amqp from 'amqplib';

/**
 * El mecanismo de la caída que encontró la carga de T-51, contra el broker real.
 *
 * `heartbeat.spec.ts` comprueba que el adaptador pide 30 s en vez de los 5 que
 * trae `amqp-connection-manager`. Lo que no puede comprobar sin broker es **por
 * qué importa**, y el porqué es la premisa entera del arreglo: un servicio Node
 * es de un solo hilo, un bucle de eventos ocupado no manda latidos, y RabbitMQ
 * cierra la conexión al perder dos seguidos. Con 5 s eso son diez segundos de
 * margen — menos de lo que tarda un pico de GC o una ráfaga de mensajes en un
 * contenedor con 250 mCPU. Con 30 s son sesenta.
 *
 * Así que se mide eso: se bloquea el bucle doce segundos y se mira cuál de las
 * dos conexiones sobrevive. Lo intentamos primero por la API de gestión, que
 * publica el `timeout` negociado, y contestó 401: el usuario de la aplicación
 * no tiene permisos de gestión. Una prueba que pasa porque no pudo mirar no
 * vale, así que se mide el comportamiento y no el número.
 *
 * Necesita el stack local: sin `RABBITMQ_URL` se omite.
 */

jest.setTimeout(60_000);

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const runIntegrationTests = !!RABBITMQ_URL;

/** Bloquea el bucle de eventos de verdad: sin `await`, nada corre mientras. */
function blockEventLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* a propósito */
  }
}

async function connectionSurvivingABlockedLoop(heartbeat: number): Promise<boolean> {
  const connection = await amqp.connect(`${RABBITMQ_URL!}?heartbeat=${heartbeat}`);
  let closed = false;
  connection.on('error', () => {
    closed = true;
  });
  connection.on('close', () => {
    closed = true;
  });

  try {
    blockEventLoop(15_000);
    // Un tick para que el socket entregue lo que el broker ya mandó.
    await new Promise((done) => setTimeout(done, 2_000));

    if (closed) return false;

    // Y que siga sirviendo, no sólo que nadie haya avisado de lo contrario.
    const channel = await connection.createChannel();
    await channel.close();
    return true;
  } catch {
    return false;
  } finally {
    try {
      await connection.close();
    } catch {
      /* ya estaba cerrada: es el caso que se está midiendo */
    }
  }
}

(runIntegrationTests ? describe : describe.skip)('un bucle de eventos bloqueado', () => {
  beforeAll(() => {
    if (!RABBITMQ_URL) {
      console.warn('Skipping heartbeat integration test: RABBITMQ_URL is not set.');
    }
  });

  it('cuesta la conexión con los 5 s que trae la librería', async () => {
    expect(await connectionSurvivingABlockedLoop(5)).toBe(false);
  });

  it('no la cuesta con los 30 s que pide el adaptador', async () => {
    expect(await connectionSurvivingABlockedLoop(30)).toBe(true);
  });
});
