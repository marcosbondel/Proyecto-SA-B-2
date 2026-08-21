/**
 * Generate a RabbitMQ definitions JSON file from the canonical topology in
 * src/routing/topology.ts (compiled to dist/routing/topology.js). The output
 * is consumed by the local broker via `load_definitions` in
 * infra/docker/rabbitmq/rabbitmq.conf.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import topology from '../dist/routing/topology.js';
import routingKeys from '../dist/routing/routing-keys.js';

const {
  QUEUES,
  RETRY_DELAYS_MS,
  deadLetterQueueName,
  retryQueueName,
} = topology;

const { EXCHANGES } = routingKeys;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const adminUser = process.env.RABBITMQ_DEFAULT_USER ?? 'admin';
const adminPass = process.env.RABBITMQ_DEFAULT_PASS ?? 'admin';
const appUser = process.env.RABBITMQ_APP_USER ?? 'bank_app';
const appPass = process.env.RABBITMQ_APP_PASSWORD ?? 'bank_app';

const vhost = '/';

const exchanges = Object.values(EXCHANGES).map((name) => ({
  name,
  vhost,
  type: 'topic',
  durable: true,
  auto_delete: false,
  internal: false,
  arguments: {},
}));

const queues = [];
const bindings = [];

for (const queue of QUEUES) {
  queues.push({
    name: queue.name,
    vhost,
    durable: true,
    auto_delete: false,
    arguments: {},
  });

  for (const delay of RETRY_DELAYS_MS) {
    const attempt = RETRY_DELAYS_MS.indexOf(delay) + 1;
    queues.push({
      name: retryQueueName(queue.name, attempt),
      vhost,
      durable: true,
      auto_delete: false,
      arguments: {
        'x-message-ttl': delay,
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue.name,
      },
    });
  }

  queues.push({
    name: deadLetterQueueName(queue.name),
    vhost,
    durable: true,
    auto_delete: false,
    arguments: {},
  });

  for (const binding of queue.bindings) {
    bindings.push({
      source: binding.exchange,
      vhost,
      destination: queue.name,
      destination_type: 'queue',
      routing_key: binding.pattern,
      arguments: {},
    });
  }
}

const definitions = {
  rabbit_version: '4.3.4',
  rabbitmq_version: '4.3.4',
  product_name: 'RabbitMQ',
  product_version: '4.3.4',
  users: [
    { name: adminUser, password: adminPass, tags: 'administrator' },
    { name: appUser, password: appPass, tags: '' },
  ],
  vhosts: [{ name: vhost }],
  permissions: [
    {
      user: adminUser,
      vhost,
      configure: '.*',
      write: '.*',
      read: '.*',
    },
    {
      user: appUser,
      vhost,
      configure: '.*',
      write: '.*',
      read: '.*',
    },
  ],
  topic_permissions: [],
  parameters: [],
  global_parameters: [
    { name: 'cluster_name', value: 'rabbit@rabbitmq' },
  ],
  policies: [],
  queues: queues,
  exchanges: exchanges,
  bindings: bindings,
};

const outputPath = process.argv[2] ?? path.join(__dirname, '../../../../infra/docker/rabbitmq/rabbitmq_definitions.json');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(definitions, null, 2) + '\n', 'utf-8');

console.log(`Exported ${exchanges.length} exchanges, ${queues.length} queues, ${bindings.length} bindings to ${outputPath}`);
