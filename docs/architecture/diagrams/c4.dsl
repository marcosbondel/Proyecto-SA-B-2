workspace "Bank USAC - Fase III" "Modelo compartido; estado configurado contrastado con GKE el 2026-10-21. Las variantes locales se leen en deployment.md." {
    !identifiers hierarchical
    model {
        cliente = person "Cliente" "Consulta y opera sus cuentas; consulta seguimiento y notificaciones."
        cajero = person "Cajero receptor" "Atiende clientes en ventanilla con permisos D-06."
        admin = person "Administrador" "Consulta auditoría, pagos y notificaciones; configura la simulación por API."
        sre = person "Operador / SRE" "Diagnostica métricas, trazas, logs y alertas en Grafana."
        banco = softwareSystem "Banco externo" "Contrato interbancario v1: HTTP 202, callback, consulta, cancelación y reverso."
        resend = softwareSystem "Resend" "Entrega real del correo de activación. También admite recuperación, rechazo de identidad y cambio de contraseña según evento."
        bankusac = softwareSystem "Bank USAC" "Cinco servicios de dominio, API Gateway y frontend; Saga y observabilidad." {
            frontend = container "Frontend" "SSR en Cloud Run; proxy Nitro hacia el Gateway. También existe carga web en GKE." "Nuxt 4 / Vue 3 / Nitro"
            group "GKE - namespace dev o prod" {
                gateway = container "API Gateway" "JWT y roles; REST, interbank/v1, alertas SLO y simulación. Sin BD ni lógica de negocio." "Node.js 24 / NestJS"
                customer = container "Customer Service" "Identidad, KYC, credenciales y eventos del ciclo de vida; verifica foto." "Node.js 24 / NestJS"
                account = container "Account Service" "Saldo exacto, comisión, liquidación y compensación; anomalía de frecuencia N/M." "Node.js 24 / NestJS"
                transaction = container "Transaction Service" "Saga de seis estados, historial, outbox y medición de transiciones." "Node.js 24 / NestJS"
                payment = container "Payment Service" "Reintentos persistidos; simulación en caliente; envío/recepción y protocolo TIMEOUT interbancario." "Node.js 24 / NestJS"
                audit = container "Notification & Audit" "Auditoría redactada, notificaciones y alertas; consulta por correlación, traza, servicio y nivel." "Node.js 24 / NestJS"
                rabbit = container "RabbitMQ" "Comandos, eventos y request/reply. Volumen persistente por entorno." "RabbitMQ / AMQP 0-9-1 (GKE observado: 3.13-management)" "Broker"
                minio = container "MinIO" "Objetos de identidad; Gateway escribe y Customer verifica." "API S3 compatible"
                mock = container "partner-bank-mock (opcional)" "Simula contrato v1 y fallos. Observado en prod v1.3.6; ausente en dev el 2026-10-21; no es un sexto servicio de dominio." "Node.js / HTTP :3021"
            }
            group "Compute Engine - cinco VMs privadas fuera de GKE" {
                customer_db = container "Customer DB" "customer / customer_dev; exclusiva de Customer." "PostgreSQL 18.4 / pg" "Database"
                account_db = container "Account DB" "account / account_dev; exclusiva de Account." "PostgreSQL 18.4 / pg" "Database"
                transaction_db = container "Transaction DB" "transaction / transaction_dev; exclusiva de Transaction." "PostgreSQL 18.4 / pg" "Database"
                payment_db = container "Payment DB" "payment / payment_dev; exclusiva de Payment." "PostgreSQL 18.4 / pg" "Database"
                audit_db = container "Audit DB" "notification_audit / notification_audit_dev; exclusiva de Audit." "PostgreSQL 18.4 / pg" "Database"
            }
            group "GKE - namespace observability" {
                collector = container "otel-gateway" "Deployment: recibe trazas y métricas; redacta atributos sensibles." "OpenTelemetry Collector / OTLP :4317,:4318" "Telemetry"
                agent = container "otel-log-agent" "DaemonSet: lee stdout JSON en /var/log/pods, extrae contexto y redacta." "OpenTelemetry Collector / filelog" "Telemetry"
                prometheus = container "Prometheus" "Scrape, reglas de grabación y SLO; PVC 10 GiB, retención 7 días." "Prometheus / PromQL" "Telemetry"
                tempo = container "Tempo" "Trazas correlacionadas; PVC 10 GiB, retención 7 días." "Grafana Tempo / TraceQL" "Telemetry"
                loki = container "Loki" "Logs y metadatos de correlación; PVC 10 GiB, retención 7 días." "Grafana Loki / LogQL" "Telemetry"
                grafana = container "Grafana" "Nueve dashboards, 16 alertas y Explore. LoadBalancer público; autenticación admin." "Grafana 12.3.1 / PVC 2 GiB" "Telemetry"
                ksm = container "kube-state-metrics" "Estado de Deployments, réplicas y HPA; señal de anotación de despliegue." "Kubernetes metrics / HTTP :8080" "Telemetry"
            }
        }
        cliente -> bankusac "Opera y sigue sus operaciones" "HTTPS / interfaz web"
        cajero -> bankusac "Atiende en ventanilla" "HTTPS / interfaz web"
        admin -> bankusac "Supervisa y consulta auditoría" "HTTPS / interfaz web"
        sre -> bankusac "Investiga incidentes y SLO" "Grafana / Explore"
        bankusac -> banco "Envía depósitos y resultados; consulta, cancela y revierte" "HTTP(S) / JSON / X-Api-Key / traceparent"
        banco -> bankusac "Entrega depósitos y callbacks" "Contrato v1 / HTTP 202 + resultado asíncrono"
        bankusac -> resend "Entrega activación" "HTTPS / API Resend"
        cliente -> bankusac.frontend "Opera" "HTTPS :443"
        cajero -> bankusac.frontend "Atiende" "HTTPS :443"
        admin -> bankusac.frontend "Supervisa" "HTTPS :443"
        sre -> bankusac.grafana "Diagnostica y consulta" "HTTP :80 / sesión autenticada"
        bankusac.frontend -> bankusac.gateway "Proxy SSR/API" "HTTP :3000 / REST JSON / correlationId"
        bankusac.gateway -> bankusac.rabbit "Comandos, consultas y callback traducido a mensaje" "AMQP 0-9-1 :5672 / request-reply <=5 s"
        bankusac.rabbit -> bankusac.gateway "Respuestas de dominio" "AMQP :5672 / correlationId + traceparent"
        bankusac.rabbit -> bankusac.customer "Comandos y KYC" "AMQP / asíncrono"
        bankusac.customer -> bankusac.rabbit "Respuestas y eventos de ciclo de vida" "AMQP / asíncrono"
        bankusac.rabbit -> bankusac.account "Movimientos y consultas" "AMQP / asíncrono"
        bankusac.account -> bankusac.rabbit "Veredictos y account.anomaly.detected.v1" "AMQP / asíncrono"
        bankusac.rabbit -> bankusac.transaction "Solicitudes y eventos de Saga" "AMQP / asíncrono"
        bankusac.transaction -> bankusac.rabbit "KYC, débito, pago, crédito y compensación" "AMQP / outbox / asíncrono"
        bankusac.rabbit -> bankusac.payment "Pagos, depósitos y resultados v1" "AMQP / asíncrono"
        bankusac.payment -> bankusac.rabbit "Veredictos, acciones de Account y respuestas" "AMQP / outbox / asíncrono"
        bankusac.rabbit -> bankusac.audit "Eventos y consultas de auditoría" "AMQP / asíncrono"
        bankusac.audit -> bankusac.rabbit "Sólo respuestas" "AMQP / request-reply"
        bankusac.gateway -> bankusac.minio "Deposita foto" "S3 / HTTP :9000"
        bankusac.customer -> bankusac.minio "Verifica objeto y digest" "S3 / HTTP :9000"
        bankusac.customer -> bankusac.customer_db "Sólo su base" "TCP :5432 / pg / SQL parametrizado"
        bankusac.account -> bankusac.account_db "Sólo su base; row lock" "TCP :5432 / NUMERIC(14,2)"
        bankusac.transaction -> bankusac.transaction_db "Sólo su base; estado + outbox" "TCP :5432 / transacción local"
        bankusac.payment -> bankusac.payment_db "Sólo su base; reintentos y leases" "TCP :5432 / transacción local"
        bankusac.audit -> bankusac.audit_db "Sólo su base; payload redactado" "TCP :5432 / deduplicación"
        bankusac.payment -> banco "Contrato v1: envío, sondeo, cancelación y reverso" "HTTP(S) / JSON / X-Api-Key / traceparent"
        banco -> bankusac.gateway "Depósitos y callbacks /interbank/v1/*" "HTTP :3000 / X-Api-Key / traceparent"
        bankusac.payment -> bankusac.mock "Alternativa de prueba configurada explícitamente" "HTTP :3021 / contrato v1"
        bankusac.mock -> bankusac.gateway "Callback de prueba" "HTTP /interbank/v1/*"
        bankusac.audit -> resend "Correo de activación" "HTTPS :443 / API Resend"
        bankusac.gateway -> bankusac.collector "Trazas y métricas" "OTLP gRPC :4317 o HTTP :4318"
        bankusac.customer -> bankusac.collector "Trazas y métricas" "OTLP / @bank/observability"
        bankusac.account -> bankusac.collector "Trazas y métricas" "OTLP / @bank/observability"
        bankusac.transaction -> bankusac.collector "Trazas y métricas" "OTLP / @bank/observability"
        bankusac.payment -> bankusac.collector "Trazas y métricas" "OTLP / @bank/observability"
        bankusac.audit -> bankusac.collector "Trazas y métricas" "OTLP / @bank/observability"
        bankusac.collector -> bankusac.tempo "Exporta spans redactados" "OTLP gRPC :4317"
        bankusac.prometheus -> bankusac.collector "Scrape de métricas" "HTTP :8889 /metrics"
        bankusac.agent -> bankusac.loki "Logs de stdout; sin broker" "OTLP HTTP :3100 /otlp"
        bankusac.prometheus -> bankusac.frontend "Métricas web" "HTTP /metrics (carga web de GKE)"
        bankusac.prometheus -> bankusac.rabbit "Scrape del broker" "HTTP :15692 /metrics"
        bankusac.prometheus -> bankusac.ksm "Scrape de plataforma" "HTTP :8080 /metrics"
        bankusac.grafana -> bankusac.prometheus "SLI, SLO y error budget" "PromQL / HTTP"
        bankusac.grafana -> bankusac.tempo "Trazas" "TraceQL / HTTP :3200"
        bankusac.grafana -> bankusac.loki "Logs y salto a traza" "LogQL / HTTP :3100"
        bankusac.grafana -> bankusac.gateway "Webhook POST /api/alerts/slo" "HTTP :3000 / token secreto"
    }
    views {
        systemContext bankusac "Diagrama_Contexto" {
            include cliente cajero admin sre bankusac banco resend
            autoLayout lr 700 450
        }
        container bankusac "Diagrama_Contenedores" {
            include *
            autoLayout lr 900 500
        }
        styles {

            element "Element" {
                fontSize 22
                width 390
            }
            element "Person" {
                shape Person
                background #ffffff
                color #398819
                stroke #398819
            }
            element "Software System" {
                background #ffffff
                color #ef9425
                stroke #ef9425
            }
            element "Container" {
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            element "Database" {
                shape Cylinder
                background #f1f4f8
                color #336791
                stroke #336791
            }
            element "Broker" {
                shape Pipe
                background #ffffff
                color #c11926
                stroke #c11926
            }
            element "Telemetry" {
                background #f6f0ff
                color #70519b
                stroke #70519b
            }
            relationship "Relationship" {
                color #707070
                fontSize 16
                style solid
            }

        }
    }
}
