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

/*
 * This file emits the broker *topology* only — exchanges, queues, bindings — and
 * deliberately no users or permissions. A definitions file that named accounts
 * would win over RABBITMQ_DEFAULT_USER/PASS on import and silently overwrite the
 * password a developer set in infra/docker/.env. The admin account comes from
 * the image's RABBITMQ_DEFAULT_USER, and the application account from the
 * `rabbitmq-init` service (scripts/init-rabbitmq.sh); see the comments in
 * infra/docker/rabbitmq/rabbitmq.conf. Do not add users back here.
 */
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
  // Topology only — no users/permissions. See the note above and rabbitmq.conf.
  users: [],
  vhosts: [{ name: vhost }],
  permissions: [],
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
