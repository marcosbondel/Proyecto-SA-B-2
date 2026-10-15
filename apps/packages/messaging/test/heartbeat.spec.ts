import { EXCHANGES } from '@bank/contracts';

import { MessageBroker } from '../src/broker';

/**
 * Una regresión de la caída que encontró la carga de T-51.
 *
 * `amqp-connection-manager` manda un latido cada **5 segundos** por defecto, y
 * RabbitMQ cierra la conexión cuando pierde dos seguidos. Un servicio Node con
 * un límite de 250 mCPU puede tener el bucle de eventos ocupado diez segundos
 * bajo carga sin estar caído — pero con ese latido el broker lo da por muerto,
 * `amqplib` emite un error de socket y el proceso termina en 1. Los siete
 * servicios comparten este adaptador, así que se reinician todos a la vez.
 *
 * No se puede medir aquí lo que negocia el servidor; sí se puede medir que la
 * opción llega, que es lo único que distingue el defecto de su arreglo. Lo que
 * queda del lado del broker real lo comprueba
 * `test/heartbeat.integration.spec.ts`.
 */

const connectOptions: Record<string, unknown>[] = [];

jest.mock('amqp-connection-manager', () => ({
  connect: (_urls: string[], options: Record<string, unknown>) => {
    connectOptions.push(options);
    return {
      isConnected: () => true,
      createChannel: () => ({
        waitForConnect: () => Promise.resolve(),
        publish: () => Promise.resolve(),
      }),
      close: () => Promise.resolve(),
    };
  },
}));

function build(heartbeatSeconds?: number): void {
  new MessageBroker({
    url: 'amqp://localhost',
    exchanges: [EXCHANGES.events],
    errorExchange: EXCHANGES.errors,
    ...(heartbeatSeconds === undefined ? {} : { heartbeatSeconds }),
  });
}

describe('el latido hacia el broker', () => {
  beforeEach(() => {
    connectOptions.length = 0;
  });

  it('no es el de la librería, que convierte un pico de CPU en un reinicio', () => {
    build();

    expect(connectOptions[0]!['heartbeatIntervalInSeconds']).toBe(30);
    expect(connectOptions[0]!['heartbeatIntervalInSeconds']).not.toBe(5);
  });

  it('se puede bajar, porque el valor correcto depende del despliegue', () => {
    build(10);

    expect(connectOptions[0]!['heartbeatIntervalInSeconds']).toBe(10);
  });

  it('sigue pasando el intervalo de reconexión, que es otra cosa', () => {
    build();

    expect(connectOptions[0]!['reconnectTimeInSeconds']).toBe(5);
  });
});
