#!/usr/bin/env python3
"""
La telemetría falsa que `obs-kind.sh` empuja al Collector: UNA de cada métrica
del catálogo (`docs/sre/telemetry-catalog.md`), con los nombres, la unidad, las
etiquetas y los VALORES de etiqueta que emite el código de verdad
(`apps/services/*/src/infrastructure/telemetry/*.ts` y
`apps/packages/messaging/src/telemetry.ts`), más las trazas que los paneles de
Tempo buscan y una traza con secretos para la prueba de redacción.

Por qué todas y no dos (T-60): `check-dashboards.py --live` ejecuta cada
consulta de los nueve dashboards y falla si sale vacía. Con sólo dos métricas
falsas, todo panel de clientes, cuentas, pagos o interbancario saldría vacío por
falta de productor y la comprobación no distinguiría eso de un panel roto — que
es justo lo que tiene que distinguir.

Los valores de etiqueta van en minúsculas donde el código hace `toLowerCase()`.
Si alguien escribe aquí `"COMPLETED"` en vez de `"completed"`, un panel que
filtre bien saldrá vacío y la prueba fallará: es a propósito — este archivo
tiene que hablar como el código, no como el panel.

  obs-kind-payloads.py metrics <paso 1|2> > metrics-N.json
  obs-kind-payloads.py traces <traceId> <spanId> <traceIdRedaccion> <secreto> <marca> > trace.json
"""

import json
import sys
import time

S = 1_000_000_000


def attrs(d):
    salida = []
    for k, v in d.items():
        if isinstance(v, bool):
            salida.append({"key": k, "value": {"boolValue": v}})
        elif isinstance(v, int):
            salida.append({"key": k, "value": {"intValue": str(v)}})
        else:
            salida.append({"key": k, "value": {"stringValue": str(v)}})
    return salida


def recurso(servicio):
    return {"attributes": attrs({
        "service.name": servicio,
        "deployment.environment": "prod",
        # A propósito: si `resource_to_telemetry_conversion` se encendiera, la
        # comprobación 9 lo vería como etiqueta.
        "k8s.pod.name": f"{servicio}-7d9f-xyz",
    })}


def contador(nombre, unidad, puntos, paso, inicio, ahora):
    return {"name": nombre, "unit": unidad, "sum": {
        "aggregationTemporality": 2, "isMonotonic": True,
        "dataPoints": [{"asInt": str(base * paso), "startTimeUnixNano": str(inicio),
                        "timeUnixNano": str(ahora), "attributes": attrs(a)} for a, base in puntos]}}


def histograma(nombre, unidad, limites, puntos, paso, inicio, ahora):
    """puntos: [(atributos, [cuenta por bucket, len(limites)+1], suma)]"""
    dps = []
    for a, cubetas, suma in puntos:
        cub = [c * paso for c in cubetas]
        dps.append({"count": str(sum(cub)), "sum": suma * paso, "explicitBounds": limites,
                    "bucketCounts": [str(c) for c in cub], "startTimeUnixNano": str(inicio),
                    "timeUnixNano": str(ahora), "attributes": attrs(a)})
    return {"name": nombre, "unit": unidad, "histogram": {"aggregationTemporality": 2, "dataPoints": dps}}


HTTP_LIMITES = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]


def metricas(paso):
    ahora = int(time.time() * S) + (paso - 1) * 20 * S
    inicio = int(time.time() * S) - 300 * S
    c = lambda *a: contador(*a, paso, inicio, ahora)  # noqa: E731
    h = lambda *a: histograma(*a, paso, inicio, ahora)  # noqa: E731

    def mensajeria(colas, exchanges):
        return [
            c("messaging.client.consumed.messages", "{message}",
              [({"messaging.system": "rabbitmq", "messaging.operation.name": "process",
                 "messaging.destination.name": q, "bank.delivery.outcome": o}, n)
               for q in colas for o, n in (("ack", 20), ("retry", 2), ("dead_letter", 1))]),
            h("messaging.process.duration", "s", [0.01, 0.1, 1, 5],
              [({"messaging.system": "rabbitmq", "messaging.operation.name": "process",
                 "messaging.destination.name": q, "bank.delivery.outcome": "ack"}, [10, 8, 2, 0, 0], 3.0)
               for q in colas]),
            c("messaging.client.sent.messages", "{message}",
              [({"messaging.system": "rabbitmq", "messaging.operation.name": "publish",
                 "messaging.destination.name": x}, 15) for x in exchanges]
              + [({"messaging.system": "rabbitmq", "messaging.operation.name": "publish",
                   "messaging.destination.name": exchanges[0], "error.type": "Error"}, 1)]),
        ]

    porservicio = {
        "gateway": [
            h("http.server.request.duration", "s", HTTP_LIMITES, [
                ({"http.request.method": "GET", "http.route": "/api/accounts", "http.response.status_code": 200},
                 [0, 0, 5, 10, 5, 5, 10, 5, 2, 1, 1, 0, 0, 0, 0], 12.0),
                ({"http.request.method": "POST", "http.route": "/api/transfers", "http.response.status_code": 202},
                 [0, 0, 0, 2, 2, 4, 8, 6, 2, 2, 2, 1, 0, 0, 0], 20.0),
                ({"http.request.method": "POST", "http.route": "/api/transfers", "http.response.status_code": 503},
                 [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4.0),
                # Los sondeos: tienen que existir para comprobar que las reglas
                # los excluyen, no para contar.
                ({"http.request.method": "GET", "http.route": "/health", "http.response.status_code": 200},
                 [50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.1),
            ]),
        ] + mensajeria(["gateway.replies"], ["bank.commands"]),
        "transaction-service": [
            c("bank.transfer.started", "{transfer}", [({}, 5)]),
            c("bank.transfer.finished", "{transfer}", [
                ({"result": "completed", "reason": "NONE"}, 3),
                ({"result": "compensated", "reason": "PAYMENT_FAILED"}, 1),
                ({"result": "failed", "reason": "INSUFFICIENT_FUNDS"}, 1),
            ]),
            h("bank.transfer.duration", "s", [0.5, 1, 2.5, 5, 10, 30], [
                ({"result": "completed"}, [0, 2, 1, 0, 0, 0, 0], 3.5),
                ({"result": "compensated"}, [0, 0, 0, 0, 1, 0, 0], 8.0),
                ({"result": "failed"}, [1, 0, 0, 0, 0, 0, 0], 0.3),
            ]),
        ] + mensajeria(["transaction.events"], ["bank.events"]),
        "payment-service": [
            c("bank.payment.provider.calls", "{call}", [
                ({"result": "success", "source": "provider"}, 8),
                ({"result": "failure", "source": "provider"}, 1),
                ({"result": "timeout", "source": "simulation"}, 1),
            ]),
            h("bank.payment.provider.duration", "s", [0.1, 0.5, 1, 5, 30], [
                ({"result": "success"}, [2, 4, 2, 0, 0, 0], 4.0),
                ({"result": "timeout"}, [0, 0, 0, 0, 1, 0], 6.0),
            ]),
            c("bank.payment.simulation.changes", "{change}", [({"action": "set"}, 1)]),
            c("bank.interbank.deposits", "{deposit}", [({"result": "accepted"}, 9), ({"result": "rejected"}, 1)]),
            h("bank.interbank.deposit.duration", "s", [0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60], [
                ({"result": "accepted"}, [1, 3, 3, 2, 0, 0, 0, 0, 0, 0, 0], 6.0),
            ]),
            c("bank.interbank.callbacks", "{attempt}", [({"result": "delivered"}, 9), ({"result": "failed"}, 1)]),
            c("bank.interbank.sent", "{deposit}", [
                ({"result": "accepted"}, 8), ({"result": "rejected"}, 1), ({"result": "timeout"}, 1),
            ]),
            h("bank.interbank.confirmation.duration", "s", [0.25, 0.5, 1, 2, 3, 5, 10, 20, 30, 60], [
                ({"result": "accepted"}, [0, 2, 3, 2, 1, 0, 0, 0, 0, 0, 0], 9.0),
            ]),
        ] + mensajeria(["payment.commands"], ["bank.events"]),
        "customer-service": [
            c("bank.customer.kyc.decisions", "{decision}", [
                ({"result": "verified", "path": "teller"}, 4), ({"result": "rejected", "path": "teller"}, 1),
            ]),
            h("bank.customer.kyc.time_to_decision", "s",
              [1, 5, 30, 60, 300, 900, 3600, 14400, 86400, 259200, 604800], [
                  ({"path": "teller"}, [0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], 400.0),
              ]),
            c("bank.customer.registration.refusals", "{registration}", [({"reason": "DUPLICATE_DOCUMENT"}, 1)]),
        ] + mensajeria(["customer.commands"], ["bank.events"]),
        "account-service": [
            c("bank.account.operations", "{operation}", [
                ({"account_type": "AHORRO", "operation": "debit"}, 4),
                ({"account_type": "MONETARIA", "operation": "credit"}, 4),
                ({"account_type": "AHORRO", "operation": "compensation"}, 1),
            ]),
            c("bank.account.anomalies", "{anomaly}", [({"account_type": "AHORRO", "rule": "HIGH_FREQUENCY"}, 1)]),
        ] + mensajeria(["account.commands"], ["bank.events"]),
        "notification-audit-service": [
            c("bank.audit.events", "{event}", [
                ({"family": "transaction", "severity": "info", "outcome": "recorded", "processing": "valid"}, 10),
                ({"family": "transaction", "severity": "warning", "outcome": "recorded", "processing": "invalid"}, 1),
            ]),
            c("bank.audit.notifications", "{notification}", [({"severity": "info", "result": "sent"}, 5)]),
            c("bank.audit.alerts.received", "{alert}", [({"status": "firing", "severity": "warning"}, 1)]),
        ] + mensajeria(["audit.transaction"], ["bank.events"]),
    }
    return {"resourceMetrics": [
        {"resource": recurso(s), "scopeMetrics": [{"scope": {"name": s}, "metrics": m}]}
        for s, m in porservicio.items()
    ]}


def trazas(trace_id, span_id, trace_redaccion, secreto, marca):
    ahora = int(time.time() * S)

    def span(tid, sid, nombre, a, padre=None, eventos=None, estado=None):
        s = {"traceId": tid, "spanId": sid, "name": nombre, "kind": 1,
             "startTimeUnixNano": str(ahora), "endTimeUnixNano": str(ahora + 50_000_000),
             "attributes": attrs(a)}
        if padre:
            s["parentSpanId"] = padre
        if eventos:
            s["events"] = eventos
        if estado:
            s["status"] = estado
        return s

    hijo = lambda n: span_id[:-2] + f"{n:02x}"  # noqa: E731
    saga = [
        span(trace_id, span_id, "bank.transfer.state_changed", {"bank.correlation_id": "corr-obs-kind"}),
        span(trace_id, hijo(1), "transfer", {"bank.transfer.status": "COMPENSATED",
                                             "bank.correlation_id": "corr-obs-kind"}, span_id),
        span(trace_id, hijo(2), "saga.compensation completed", {"bank.correlation_id": "corr-obs-kind"}, span_id),
        span(trace_id, hijo(3), "payment.interbank state", {"bank.interbank.stage": "ACCEPTED"}, span_id),
    ]
    url = f"https://bank.example/api/customers/verify-email?token={secreto}&lang=es"
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvYnMta2luZCJ9.c2VjcmV0by" + secreto
    redaccion = [span(
        trace_redaccion, "1" * 15 + "a", marca,
        {"url.full": url, "url.query": f"token={secreto}&lang=es",
         "http.target": f"/api/customers/verify-email?token={secreto}",
         "http.url": url, "bank.debug.authorization": f"Bearer {secreto}{secreto}{secreto}",
         "bank.debug.jwt": jwt, "enduser.email": f"cliente.{secreto}@example.com"},
        eventos=[{"timeUnixNano": str(ahora + 10_000_000), "name": "exception",
                  "attributes": attrs({"exception.message": f"fetch failed for {url}"})}],
        estado={"code": 2, "message": f"GET /api/customers/verify-email?token={secreto} failed"},
    )]
    return {"resourceSpans": [
        {"resource": {"attributes": attrs({"service.name": "transaction-service", "deployment.environment": "prod"})},
         "scopeSpans": [{"scope": {"name": "bank.saga"}, "spans": saga}]},
        {"resource": {"attributes": attrs({"service.name": "gateway", "deployment.environment": "prod"})},
         "scopeSpans": [{"scope": {"name": "obs-kind"}, "spans": redaccion}]},
    ]}


if __name__ == "__main__":
    if sys.argv[1] == "metrics":
        print(json.dumps(metricas(int(sys.argv[2]))))
    elif sys.argv[1] == "traces":
        print(json.dumps(trazas(*sys.argv[2:7])))
    else:
        sys.exit(f"uso: {sys.argv[0]} metrics <1|2> | traces <traceId> <spanId> <traceIdRedaccion> <secreto> <marca>")
