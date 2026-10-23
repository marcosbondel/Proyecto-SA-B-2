workspace "Bank USAC - C4 Componentes Fase III" "Una vista de componentes por contenedor; interfaces -> application -> domain; infrastructure implementa puertos." {
    !identifiers hierarchical
    model {
        broker = softwareSystem "RabbitMQ" "Transporte AMQP; contexto W3C; no lógica de negocio."
        bank = softwareSystem "Banco externo" "Contrato v1 HTTP(S) / X-Api-Key."
        resend = softwareSystem "Resend" "Proveedor de correo por HTTPS."
        bankusac = softwareSystem "Bank USAC" "Cinco servicios y un Gateway." {
            gateway = container "API Gateway" "Límite de contenedor; Node.js 24 / NestJS." "TypeScript / NestJS" {
                http = component "Controladores REST / InterbankV1 / Alerts" "/api/*; /interbank/v1/*; /api/alerts/slo; /api/payments/simulation" "NestJS / HTTP :3000" "Interfaces"
                guards = component "Guards JWT, roles, API key y webhook" "Autentica en el borde; límites, validación Zod/DTO; sin reglas bancarias" "NestJS Guards" "Interfaces"
                routes = component "Casos de uso de rutas" "Traduce HTTP a comandos; compone accounts/dashboard sin calcular negocio" "TypeScript / application" "Application"
                broker = component "Request/reply por RabbitMQ" "correlationId, traceparent, techo 5 s; ninguna base de datos" "@bank/messaging / AMQP" "Infrastructure"
                objects = component "Carga de foto" "Sube objeto antes del comando; entrega referencia al dominio dueño" "MinIO / S3 API" "Infrastructure"
            }
            customer = container "Customer Service" "Límite de contenedor; Node.js 24 / NestJS." "TypeScript / NestJS" {
                handlers = component "Handlers de identidad y KYC" "Registro, activación, autenticación, veredicto y consulta KYC" "NestJS / AMQP" "Interfaces"
                usecases = component "Casos de uso de ciclo de vida" "Emite eventos correlacionados y veredictos; redacta datos observables" "TypeScript / application" "Application"
                domain = component "Cliente y reglas de identidad" "Estados KYC; activación y credenciales independientes; decisiones puras" "TypeScript / domain" "Domain"
                repo = component "Repositorio exclusivo" "Credenciales scrypt, tokens hasheados; creation_trace y versión" "PostgreSQL 18.4 / pg" "Infrastructure"
                telemetry = component "Telemetría de ciclo de vida" "kyc decisions, p95 tiempo a decisión; logs JSON y spans" "@bank/observability / OTLP" "Infrastructure"
            }
            account = container "Account Service" "Límite de contenedor; Node.js 24 / NestJS." "TypeScript / NestJS" {
                handlers = component "Handlers de cuentas / Saga / interbancario" "Débito, crédito, compensación y consulta por número de cuenta" "NestJS / AMQP" "Interfaces"
                usecases = component "Casos de uso y monitor de actividad" "Más de N operaciones en M minutos; evento account.anomaly.detected.v1" "TypeScript / application" "Application"
                domain = component "Cuenta / dinero / reglas por tipo" "NUMERIC exacto; AHORRO cobra Q3; compensación devuelve comisión" "TypeScript / domain" "Domain"
                repo = component "Repositorio y lease de barrido" "FOR UPDATE, version, CHECK >= 0, idempotencia; advisory lock entre réplicas" "PostgreSQL 18.4 / pg" "Infrastructure"
                telemetry = component "Actividad observable" "Contadores por tipo/operación; accountId sólo en logs/trazas" "@bank/observability / OTLP" "Infrastructure"
            }
            transaction_db = container "Transaction DB" "Siete tablas propias, incluido schema_migrations; ninguna lectura a otra base." "PostgreSQL 18.4 / TCP :5432" "Database"
            transaction = container "Transaction Service" "Saga de transferencias: decide transiciones, nunca fondos. main.ts compone los adaptadores." "Node.js 24 / NestJS / TypeScript" {
                // interfaces/
                router = component "InboundMessageRouter" "Enruta por messageType; instancia por delivery y valida handler único." "interfaces / dispatch" "Interfaces"
                h_request = component "RequestTransferHandler" "transfer.requested.v1; Zod, identidad e idempotencyKey del envelope." "interfaces / AMQP / comando" "Interfaces"
                h_status = component "TransactionStatusHandler" "transaction.status.requested.v1; consulta por ID o correlación." "interfaces / AMQP / consulta" "Interfaces"
                h_list = component "TransactionListHandler" "transaction.list.query.v1; cuenta, fechas, estado y alcance del actor." "interfaces / AMQP / consulta" "Interfaces"
                h_stats = component "TransactionStatsHandler" "transaction.stats.query.v1; contadores para personal autorizado." "interfaces / AMQP / consulta" "Interfaces"
                h_attempt = component "PaymentAttemptFailedHandler" "payment.attempt.failed.v1; registra intento sin cerrar PAYMENT_PENDING." "interfaces / AMQP / evento" "Interfaces"
                h_saga = component "SagaEventHandler<T> + sagaHandlers()" "Ocho bindings: KYC; débito y rechazo; pago y rechazo; crédito y rechazo; compensación." "interfaces / AMQP / eventos" "Interfaces"
                health_port = component "DependencyHealthPort" "Broker conectado, base alcanzable y consumidores; main.ts suministra closures." "interfaces / contrato de health" "Port"
                health = component "HealthController" "/health: proceso vivo. /ready: broker, base y consumidores preparados." "interfaces / NestJS :3003" "Interfaces"
                // application/
                request = component "RequestTransferUseCase" "Valida solicitud, crea PENDING, conserva alias y abre la puerta KYC." "application / caso de uso" "Application"
                status = component "GetTransactionStatusUseCase" "Estado, phaseStatus e historial real; sólo propietario o personal." "application / caso de uso" "Application"
                list = component "ListTransactionsUseCase" "Listado acotado por identidad, cuentas, fechas y estados." "application / caso de uso" "Application"
                stats = component "GetTransactionStatsUseCase" "Agrega contadores del monitor sin leer saldos." "application / caso de uso" "Application"
                attempt = component "RecordPaymentAttemptUseCase" "Deduplica y registra intento, error y willRetry; no transiciona Saga." "application / caso de uso" "Application"
                advance = component "AdvanceSagaUseCase" "Proporciona decide/applyEvent y efectos; repositorio ejecuta bajo row lock." "application / caso de uso" "Application"
                repository_port = component "TransactionRepository" "start, applyEvent, recordAlias, list, stats, transitionsOf y dispatchPendingOutbox." "application / ports.ts" "Port"
                publisher_port = component "EventPublisher" "send/publish/reply y envelopeFor; separa construir outbox de enviar." "application / ports.ts" "Port"
                telemetry_port = component "TransferTelemetry" "openTransfer, step y paymentAttempt; sin depender del SDK." "application / ports.ts" "Port"
                // domain/
                transaction = component "Transaction + applyEvent()" "PENDING, DEBITING, PAYMENT_PENDING, COMPLETED, FAILED, COMPENSATED; transición ilegal rechazada." "domain / TypeScript puro / transaction.ts" "Domain"
                money = component "Money / amountProblem()" "Monto positivo y precisión exacta; no consulta ni calcula saldo disponible." "domain / TypeScript puro / money.ts" "Domain"
                phase = component "phaseStatusOf() / statusesInPhase()" "Proyección PENDING / APPROVED / FAILED sin sustituir los seis estados." "domain / TypeScript puro / phase-status.ts" "Domain"
                // infrastructure/
                broker = component "MessageBroker" "transaction.commands + transaction.saga; ack, retry 1/5/30 s, DLQ y contexto W3C." "infrastructure / @bank/messaging" "Infrastructure"
                publisher = component "BrokerEventPublisher" "Implementa EventPublisher; forCause conserva correlación, causalidad e identidad." "infrastructure / AMQP + Zod" "Infrastructure"
                repository = component "PostgresTransactionRepository" "FOR UPDATE; dedup messageId; estado, transición y outbox atómicos; pg parametrizado." "infrastructure / PostgreSQL + pg" "Infrastructure"
                relay = component "OutboxRelay" "dispatchPendingOutbox: SKIP LOCKED y publish con contexto; tick 200 ms, idle hasta 2 s." "infrastructure / AdaptiveTicker" "Infrastructure"
                telemetry = component "OtelTransferTelemetry" "Spans saga.*, duración y resultado; IDs en logs/trazas y etiquetas acotadas." "infrastructure / OTLP" "Infrastructure"
            }
            payment = container "Payment Service" "Límite de contenedor; Node.js 24 / NestJS." "TypeScript / NestJS" {
                handlers = component "Handlers de pagos / callbacks / v1" "Comandos AMQP de Gateway y Saga; simulación GET/PUT" "NestJS / AMQP" "Interfaces"
                usecases = component "Pago / envío / recepción / reverso" "202+callback; sondeo y cancelación; liquidación y devolución por Account" "TypeScript / application" "Application"
                domain = component "Proveedor y estados puros" "Simulación failure/timeout/latency; TIMEOUT conserva reserva; TTL180s+300s" "TypeScript / domain" "Domain"
                repo = component "Repositorio / outbox / claims" "Intentos y vencimientos en columnas; leases previenen barridos duplicados" "PostgreSQL 18.4 / pg" "Infrastructure"
                http = component "Adaptador HTTP externo v1" "X-Api-Key, Idempotency-Key y traceparent; timeout; sin redirects" "Node.js fetch / HTTP CLIENT" "Infrastructure"
                sweep = component "Sweep de reintentos y reconciliación" "1s/5s/30s; callback, probe, cancel y reverso con backoff" "Scheduler / SKIP LOCKED" "Infrastructure"
            }
            audit = container "Notification & Audit" "Límite de contenedor; Node.js 24 / NestJS." "TypeScript / NestJS" {
                handlers = component "Consumidores terminales" "Familias de eventos, anomalía y alertas; mensajes inválidos registrados" "NestJS / AMQP" "Interfaces"
                usecases = component "Auditoría / consulta / notificación" "Filtros correlationId, traceId, servicio y nivel; inbox y alertas SLO" "TypeScript / application" "Application"
                domain = component "Clasificación y redacción" "INFO/WARNING/ERROR; documento, email, monto y credenciales fuera del payload auditado" "TypeScript / domain" "Domain"
                repo = component "Repositorio exclusivo" "Dedup event_id+consumer; trace_id y notificación SLO deduplicada" "PostgreSQL 18.4 / pg" "Infrastructure"
                channel = component "Canal de entrega" "Resend para eventos permitidos; fallback simulado; nunca comandos de dominio" "Resend / HTTPS o simulated" "Infrastructure"
            }
        }
        broker -> bankusac.gateway.broker "Entrega comandos/respuestas" "AMQP 0-9-1 / asíncrono"
        bankusac.gateway.http -> bankusac.gateway.guards "Autentica y valida" "llamada interna síncrona"
        bankusac.gateway.guards -> bankusac.gateway.routes "Invoca ruta" "llamada interna síncrona"
        bankusac.gateway.routes -> bankusac.gateway.broker "Publica y espera respuesta" "llamada interna síncrona"
        bankusac.gateway.routes -> bankusac.gateway.objects "Deposita foto" "llamada interna síncrona"
        broker -> bankusac.customer.handlers "Entrega comandos/respuestas" "AMQP 0-9-1 / asíncrono"
        bankusac.customer.handlers -> bankusac.customer.usecases "Invoca caso de uso" "llamada interna síncrona"
        bankusac.customer.usecases -> bankusac.customer.domain "Decide regla pura" "llamada interna síncrona"
        bankusac.customer.usecases -> bankusac.customer.repo "Usa puerto de persistencia" "llamada interna síncrona"
        bankusac.customer.usecases -> bankusac.customer.telemetry "Registra decisión observable" "llamada interna síncrona"
        broker -> bankusac.account.handlers "Entrega comandos/respuestas" "AMQP 0-9-1 / asíncrono"
        bankusac.account.handlers -> bankusac.account.usecases "Invoca caso de uso" "llamada interna síncrona"
        bankusac.account.usecases -> bankusac.account.domain "Decide regla pura" "llamada interna síncrona"
        bankusac.account.usecases -> bankusac.account.repo "Usa puerto de persistencia" "llamada interna síncrona"
        bankusac.account.usecases -> bankusac.account.telemetry "Registra decisión observable" "llamada interna síncrona"
        broker -> bankusac.transaction.broker "Deliveries y redelivery" "AMQP :5672 / asíncrono"
        bankusac.transaction.broker -> broker "Comandos, eventos y respuestas" "AMQP :5672 / confirm publish"
        bankusac.transaction.broker -> bankusac.transaction.router "Entrega envelope / route()" "llamada local"
        bankusac.transaction.router -> bankusac.transaction.h_request "transfer.requested" "dispatch local"
        bankusac.transaction.router -> bankusac.transaction.h_status "status.requested" "dispatch local"
        bankusac.transaction.router -> bankusac.transaction.h_list "list.query" "dispatch local"
        bankusac.transaction.router -> bankusac.transaction.h_stats "stats.query" "dispatch local"
        bankusac.transaction.router -> bankusac.transaction.h_attempt "attempt.failed" "dispatch local"
        bankusac.transaction.router -> bankusac.transaction.h_saga "8 eventos de Saga" "dispatch local"
        bankusac.transaction.h_request -> bankusac.transaction.request "execute()" "llamada local"
        bankusac.transaction.h_status -> bankusac.transaction.status "execute()" "llamada local"
        bankusac.transaction.h_list -> bankusac.transaction.list "execute()" "llamada local"
        bankusac.transaction.h_stats -> bankusac.transaction.stats "execute()" "llamada local"
        bankusac.transaction.h_attempt -> bankusac.transaction.attempt "execute()" "llamada local"
        bankusac.transaction.h_saga -> bankusac.transaction.advance "execute(event)" "llamada local"
        bankusac.transaction.request -> bankusac.transaction.advance "Abre KYC / reanuda PENDING" "llamada local"
        bankusac.transaction.request -> bankusac.transaction.transaction "openTransaction / requestRefusal" "regla pura"
        bankusac.transaction.advance -> bankusac.transaction.transaction "applyEvent como callback decide" "regla pura bajo lock"
        bankusac.transaction.transaction -> bankusac.transaction.money "amountProblem / sameAmount" "regla pura"
        bankusac.transaction.advance -> bankusac.transaction.phase "phaseStatusOf" "proyección pura"
        bankusac.transaction.status -> bankusac.transaction.transaction "mayReadTransaction" "regla pura"
        bankusac.transaction.status -> bankusac.transaction.phase "phaseStatusOf" "proyección pura"
        bankusac.transaction.list -> bankusac.transaction.phase "statusesInPhase / phaseStatusOf" "proyección pura"
        bankusac.transaction.request -> bankusac.transaction.repository_port "start / recordAlias" "usa puerto"
        bankusac.transaction.advance -> bankusac.transaction.repository_port "applyEvent(decide, outbound)" "usa puerto"
        bankusac.transaction.status -> bankusac.transaction.repository_port "find / transitions / paymentOutcome" "usa puerto"
        bankusac.transaction.list -> bankusac.transaction.repository_port "list con filtros" "usa puerto"
        bankusac.transaction.stats -> bankusac.transaction.repository_port "stats" "usa puerto"
        bankusac.transaction.attempt -> bankusac.transaction.repository_port "recordPaymentAttempt" "usa puerto"
        bankusac.transaction.request -> bankusac.transaction.publisher_port "envelopeFor / rechazo" "usa puerto"
        bankusac.transaction.advance -> bankusac.transaction.publisher_port "envelopeFor: comandos y terminal" "usa puerto"
        bankusac.transaction.status -> bankusac.transaction.publisher_port "reply" "usa puerto"
        bankusac.transaction.list -> bankusac.transaction.publisher_port "reply" "usa puerto"
        bankusac.transaction.stats -> bankusac.transaction.publisher_port "reply" "usa puerto"
        bankusac.transaction.request -> bankusac.transaction.telemetry_port "openTransfer" "usa puerto"
        bankusac.transaction.advance -> bankusac.transaction.telemetry_port "step" "usa puerto"
        bankusac.transaction.attempt -> bankusac.transaction.telemetry_port "paymentAttempt" "usa puerto"
        bankusac.transaction.repository -> bankusac.transaction.repository_port "Implementa" "interfaz de aplicación" "Implements"
        bankusac.transaction.publisher -> bankusac.transaction.publisher_port "Implementa" "interfaz de aplicación" "Implements"
        bankusac.transaction.telemetry -> bankusac.transaction.telemetry_port "Implementa" "interfaz de aplicación" "Implements"
        bankusac.transaction.publisher -> bankusac.transaction.broker "publish / reply; envelope validado" "llamada local"
        bankusac.transaction.repository -> bankusac.transaction_db "Siete tablas; sólo su base" "TCP :5432 / SQL parametrizado"
        bankusac.transaction.relay -> bankusac.transaction.repository_port "dispatchPendingOutbox" "usa puerto"
        bankusac.transaction.relay -> bankusac.transaction.broker "publish de cada outbox" "AMQP con traceparent"
        bankusac.transaction.health -> bankusac.transaction.health_port "Consulta salud de dependencias" "closures de main.ts"
        broker -> bankusac.payment.handlers "Entrega comandos/respuestas" "AMQP 0-9-1 / asíncrono"
        bankusac.payment.handlers -> bankusac.payment.usecases "Invoca caso de uso" "llamada interna síncrona"
        bankusac.payment.usecases -> bankusac.payment.domain "Decide regla pura" "llamada interna síncrona"
        bankusac.payment.usecases -> bankusac.payment.repo "Usa puerto de persistencia" "llamada interna síncrona"
        bankusac.payment.usecases -> bankusac.payment.http "Usa puerto del banco" "llamada interna síncrona"
        bankusac.payment.sweep -> bankusac.payment.usecases "Ejecuta vencimientos persistidos" "llamada interna síncrona"
        bankusac.payment.http -> bank "Invoca operaciones v1 y propaga traceparent" "HTTP(S) / CLIENT"
        broker -> bankusac.audit.handlers "Entrega comandos/respuestas" "AMQP 0-9-1 / asíncrono"
        bankusac.audit.handlers -> bankusac.audit.usecases "Invoca caso de uso" "llamada interna síncrona"
        bankusac.audit.usecases -> bankusac.audit.domain "Decide regla pura" "llamada interna síncrona"
        bankusac.audit.usecases -> bankusac.audit.repo "Usa puerto de persistencia" "llamada interna síncrona"
        bankusac.audit.usecases -> bankusac.audit.channel "Despacha notificación" "llamada interna síncrona"
        bankusac.audit.channel -> resend "Entrega email si el evento lo permite" "HTTPS :443"
    }
    views {
        component bankusac.gateway "Componentes_gateway" "C4 L3 - API Gateway; detalle de dependencias del contenedor." {
            include *
            autoLayout lr 600 400
        }
        component bankusac.customer "Componentes_customer" "C4 L3 - Customer Service; detalle de dependencias del contenedor." {
            include *
            autoLayout lr 600 400
        }
        component bankusac.account "Componentes_account" "C4 L3 - Account Service; detalle de dependencias del contenedor." {
            include *
            autoLayout lr 600 400
        }
        component bankusac.transaction "Diagrama_Componentes_Transaction" "C4 L3 - Transaction Service: handlers reales, casos de uso, puertos, dominio puro y outbox." {
            include *
            autoLayout lr 600 400
        }
        component bankusac.payment "Componentes_payment" "C4 L3 - Payment Service; detalle de dependencias del contenedor." {
            include *
            autoLayout lr 600 400
        }
        component bankusac.audit "Componentes_audit" "C4 L3 - Notification & Audit; detalle de dependencias del contenedor." {
            include *
            autoLayout lr 600 400
        }
        styles {
            element "Interfaces" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Application" {
                background #ffffff
                color #D17C17
                stroke #D17C17
            }
            element "Domain" {
                background #ffffff
                color #398819
                stroke #398819
            }
            element "Infrastructure" {
                background #ffffff
                color #C11926
                stroke #C11926
            }
            element "Component" {
                fontSize 20
                width 360
            }
            element "Port" {
                shape Component
                background #fff7ec
                color #d17c17
                stroke #d17c17
                border dashed
            }
            element "Database" {
                shape Cylinder
                background #f1f4f8
                color #336791
                stroke #336791
            }
            element "Group" {
                color #555555
                stroke #bbbbbb
                border dashed
                fontSize 22
            }
            relationship "Relationship" {
                color #707070
                fontSize 16
                style solid
            }
            relationship "Implements" {
                style dashed
            }
        }
    }
}
