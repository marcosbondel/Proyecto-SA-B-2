#!/usr/bin/env bash
set -uo pipefail

# One transfer, one trace — checked against the **built images** (T-48).
#
# The assignment's sharpest observability requirement is that a Saga be a single
# distributed trace: the Gateway's request, every hop through RabbitMQ, and the
# five services, joined by the W3C `traceparent` (§4.1; §8.2 criterion 2.2;
# §8.3 penalises at 50 % a trace that does not cross the broker). A unit test
# can show that one adapter injects a header. Only the running system can show
# that nothing between the Gateway and the last consumer drops it — an outbox
# relay, a retry sweep, a reply queue.
#
# So this runs after `flow-images.sh` has made its transfers, and asks the trace
# receiver one question: is there a trace that starts at the Gateway and reaches
# all five services, with every span attached to a parent inside the same trace?
#
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318 \
#     docker compose -f infra/docker/docker-compose.images.yml --profile telemetry up -d
#   SEED_DEMO_DATA=true ./infra/docker/scripts/flow-images.sh
#   ./infra/docker/scripts/trace-images.sh
#
# Exit 0 when such a trace exists, 1 when none does. It prints every transfer
# trace it found, so a failure says which service the trace stopped at.

JAEGER="${BANK_JAEGER_URL:-http://localhost:${BANK_JAEGER_PORT:-16686}}"

# The six that must appear. `web` is not instrumented (T-48 covers the five
# services and the Gateway), so it is not asked for.
REQUIRED="gateway customer-service account-service transaction-service payment-service notification-audit-service"

# Spans are exported in batches; give the last ones a moment to land.
SETTLE="${TRACE_SETTLE_SECONDS:-6}"

# Jaeger's API v3 (the only one Jaeger 2.x still serves), which answers in
# OTLP/JSON — the same shape the services export. Node and not `jq`: it is the
# one interpreter this repository already requires everywhere.
JAEGER="$JAEGER" REQUIRED="$REQUIRED" SETTLE="$SETTLE" LOOKBACK_MINUTES="${TRACE_LOOKBACK_MINUTES:-60}" node --input-type=module -e '
const jaeger = process.env.JAEGER;
const required = process.env.REQUIRED.split(" ");

try {
  const services = await (await fetch(`${jaeger}/api/v3/services`)).json();
  if (!Array.isArray(services.services)) throw new Error("unexpected answer");
} catch {
  console.error(`No trace receiver at ${jaeger}. Start the stack with --profile telemetry and`);
  console.error("OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318 (see the header of this script).");
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, Number(process.env.SETTLE) * 1000));

const now = Date.now();
const query = new URLSearchParams({
  "query.service_name": "payment-service",
  "query.start_time_min": new Date(now - Number(process.env.LOOKBACK_MINUTES) * 60_000).toISOString(),
  "query.start_time_max": new Date(now + 60_000).toISOString(),
  "query.search_depth": "200",
});
const answer = await fetch(`${jaeger}/api/v3/traces?${query}`);
if (!answer.ok) {
  console.error(`The trace receiver refused the query: HTTP ${answer.status}`);
  process.exit(1);
}
const { result } = await answer.json();

// OTLP/JSON groups spans by resource, not by trace: regroup them.
const traces = new Map();
for (const resource of result?.resourceSpans ?? []) {
  const service = resource.resource.attributes.find((a) => a.key === "service.name")?.value.stringValue;
  for (const scope of resource.scopeSpans) {
    for (const span of scope.spans) {
      if (!traces.has(span.traceId)) traces.set(span.traceId, []);
      traces.get(span.traceId).push({ ...span, service });
    }
  }
}

const SERVER = 2;
const rows = [...traces].map(([traceId, spans]) => {
  const ids = new Set(spans.map((span) => span.spanId));
  const roots = spans.filter((span) => !span.parentSpanId);
  const orphans = spans.filter((span) => span.parentSpanId && !ids.has(span.parentSpanId));
  const services = [...new Set(spans.map((span) => span.service))].sort();
  const root = roots.length === 1 ? roots[0] : null;
  return {
    traceId,
    spans: spans.length,
    services,
    hops: spans.filter((span) => /^(publish|process) /.test(span.name)).length,
    compensated: spans.some((span) => span.name.includes("compensat")),
    root: root === null ? `${roots.length} roots` : `${root.service}: ${root.name}`,
    orphans: orphans.length,
    complete:
      root !== null && root.service === "gateway" && root.kind === SERVER && orphans.length === 0 &&
      required.every((name) => services.includes(name)),
  };
});

for (const row of rows) {
  console.log(`${row.complete ? "OK  " : "--  "} ${row.traceId}  ${String(row.spans).padStart(4)} spans` +
    `  ${String(row.hops).padStart(3)} broker spans  root ${row.root}` +
    `${row.orphans > 0 ? `  ${row.orphans} orphan spans` : ""}${row.compensated ? "  (compensation)" : ""}`);
  console.log(`      ${row.services.join(", ")}`);
}

const complete = rows.filter((row) => row.complete);
console.log("");
console.log(`${rows.length} traces reach payment-service; ${complete.length} complete ` +
  `(rooted at a Gateway request, no orphan span, all of: ${required.join(", ")}).`);
process.exit(complete.length > 0 ? 0 : 1);
'
