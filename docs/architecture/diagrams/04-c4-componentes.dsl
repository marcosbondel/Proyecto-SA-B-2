workspace "Bank USAC - Transaction Service (Componentes)" "Diagrama de Componentes (C4 Nivel 3) del Transaction Service. Microservicio descompuesto: Transaction Service, participante de la Saga de transferencia. Cada componente lleva el nombre de la clase o del módulo que existe en apps/services/transaction-service/src." {

    !identifiers hierarchical

    model {
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido." {
            transaction_db = container "Transaction DB" "Base exclusiva de Transaction Service: transactions, transaction_events, processed_messages, transaction_aliases, outbox_messages." "PostgreSQL" "Database"
            transaction = container "Transaction Service" "Orquestación de transferencias y Saga; decide transiciones, nunca fondos." "NestJS" "Server-Side Application" {
                # --- interfaces/ ---
                router = component "InboundMessageRouter" "Entrega cada envelope al handler que reclama su messageType | llamada interna | síncrono" "Router de mensajes" "Interfaces Layer"
                h_transfer = component "RequestTransferHandler" "Consume transfer.requested | AMQP | comando" "Handler AMQP" "Interfaces Layer"
                h_saga = component "SagaEventHandler (x7, fábrica sagaHandlers)" "Consume account.debited, account.debit.rejected, payment.succeeded, payment.failed, account.credited, account.credit.rejected, account.debit.compensated | AMQP | eventos" "Handler AMQP" "Interfaces Layer"
                h_status = component "TransactionStatusHandler" "Consume transaction.status.requested | AMQP | comando (request/reply)" "Handler AMQP" "Interfaces Layer"
                h_list = component "TransactionListHandler" "Consume transaction.list.query | AMQP | comando (request/reply)" "Handler AMQP" "Interfaces Layer"
                h_stats = component "TransactionStatsHandler" "Consume transaction.stats.query | AMQP | comando (request/reply)" "Handler AMQP" "Interfaces Layer"
                health = component "HealthController" "/health y /ready responden preguntas distintas | HTTP | síncrono" "Controlador HTTP" "Interfaces Layer"

                # --- domain/ ---
                txEntity = component "Transaction + applyEvent" "PENDING/DEBITING/PAYMENT_PENDING/COMPLETED/FAILED/COMPENSATED; invariantes T-1 a T-7" "Entidad + Máquina de Estados" "Domain Layer"
                money = component "Money" "Monto en unidades menores de GTQ; nunca un float" "Objeto de valor" "Domain Layer"

                # --- application/ ---
                uc_request_transfer = component "RequestTransferUseCase" "Abre la Saga: crea la Transaction en PENDING; invariantes T-1 a T-4" "Caso de uso" "Application Layer"
                saga = component "AdvanceSagaUseCase" "Un paso de la Saga, sea cual sea: aplica el evento y arma el comando/evento que la transición implica" "Caso de uso" "Application Layer"
                uc_get_status = component "GetTransactionStatusUseCase" "Responde transaction.status.replied" "Caso de uso" "Application Layer"
                uc_list = component "ListTransactionsUseCase" "Responde transaction.list.replied; el alcance se decide desde la identidad del envelope" "Caso de uso" "Application Layer"
                uc_stats = component "GetTransactionStatsUseCase" "Responde transaction.stats.replied con los conteos de los dashboards" "Caso de uso" "Application Layer"
                port_repo = component "TransactionRepository" "Contrato de persistencia: start, applyEvent, dispatchPendingOutbox, list, stats" "Puerto (interfaz, application/ports.ts)" "Application Layer Port"
                port_publisher = component "EventPublisher" "Contrato de publicación: send, publish, reply y envelopeFor (arma sin enviar)" "Puerto (interfaz, application/ports.ts)" "Application Layer Port"

                # --- infrastructure/ ---
                repo_impl = component "PostgresTransactionRepository" "Implementa TransactionRepository sobre PostgreSQL: deduplica por messageId, decide bajo lock de fila y escribe el outbox en la misma transacción" "Adaptador de persistencia" "Infrastructure Layer"
                pub_adapter = component "BrokerEventPublisher" "Implementa EventPublisher: valida contra @bank/contracts y arma el envelope de seguimiento (correlationId e identidad)" "Adaptador de publicación" "Infrastructure Layer"
                outbox = component "OutboxRelay" "Barre outbox_messages PENDING con FOR UPDATE SKIP LOCKED y publica el envelope guardado tal cual" "Relay del outbox (infrastructure/scheduler/outbox.scheduler.ts)" "Infrastructure Layer"

                # --- apps/packages/messaging: el cliente AMQP NO vive en este servicio ---
                broker = component "MessageBroker" "Conexión y reconexión, suscripción por cola, ack manual, escalera de reintentos y DLQ | AMQP" "apps/packages/messaging - @bank/messaging (paquete compartido)" "Shared Package"
            }
            rabbitmq = container "RabbitMQ" "Broker central de mensajería asíncrona, fuera de kind." "RabbitMQ 4.3.4-management / AMQP" "Message Broker"
        }

        # --- broker <-> @bank/messaging ---
        bankusac.rabbitmq -> bankusac.transaction.broker "entrega transfer.requested, transaction.status.requested, transaction.list.query, transaction.stats.query, account.debited, account.debit.rejected, payment.succeeded, payment.failed, account.credited, account.credit.rejected, account.debit.compensated" "AMQP | comandos/eventos | correlationId"
        bankusac.transaction.broker -> bankusac.rabbitmq "conexión AMQP, ack manual, reintentos y DLQ" "AMQP | conexión"
        bankusac.transaction.broker -> bankusac.rabbitmq "publica account.debit.requested, payment.requested, account.credit.requested, account.debit.compensation.requested, transaction.initiated, transaction.completed, transaction.failed, transaction.compensated, transaction.status.replied, transaction.list.replied, transaction.stats.replied" "AMQP | comandos/eventos/respuestas | correlationId"

        # --- @bank/messaging -> interfaces/ (enrutamiento de deliveries) ---
        bankusac.transaction.broker -> bankusac.transaction.router "entrega el envelope ya parseado" "llamada interna | síncrono"
        bankusac.transaction.router -> bankusac.transaction.h_transfer "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.router -> bankusac.transaction.h_saga "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.router -> bankusac.transaction.h_status "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.router -> bankusac.transaction.h_list "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.router -> bankusac.transaction.h_stats "enruta por messageType" "llamada interna | síncrono"

        # --- interfaces/ -> application/ ---
        bankusac.transaction.h_transfer -> bankusac.transaction.uc_request_transfer "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_saga -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_status -> bankusac.transaction.uc_get_status "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_list -> bankusac.transaction.uc_list "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_stats -> bankusac.transaction.uc_stats "invoca" "llamada interna | síncrono"

        # --- application/ -> domain/ ---
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.txEntity "crea/valida T-1 a T-4" "llamada interna | síncrono"
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.saga "ordena el primer paso (DEBIT_ORDERED) por el mismo camino que los demás" "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.txEntity "aplica la transición válida T-5, T-6, T-7" "llamada interna | síncrono"
        bankusac.transaction.txEntity -> bankusac.transaction.money "valida monto y precisión" "llamada interna | síncrono"

        # --- application/ -> puertos (application/) ---
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.port_repo "persiste la transacción y registra el alias de un reintento" "llamada interna | síncrono"
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.port_publisher "publica transaction.initiated" "llamada interna | síncrono"
        bankusac.transaction.uc_get_status -> bankusac.transaction.port_repo "lee la transacción y su rastro de pago" "llamada interna | síncrono"
        bankusac.transaction.uc_get_status -> bankusac.transaction.port_publisher "responde transaction.status.replied" "llamada interna | síncrono"
        bankusac.transaction.uc_list -> bankusac.transaction.port_repo "lee una página de transacciones ya acotada" "llamada interna | síncrono"
        bankusac.transaction.uc_list -> bankusac.transaction.port_publisher "responde transaction.list.replied" "llamada interna | síncrono"
        bankusac.transaction.uc_stats -> bankusac.transaction.port_repo "lee los conteos" "llamada interna | síncrono"
        bankusac.transaction.uc_stats -> bankusac.transaction.port_publisher "responde transaction.stats.replied" "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.port_repo "persiste la transición y su outbox en una sola transacción" "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.port_publisher "envelopeFor: arma payment.requested, account.credit.requested, account.debit.compensation.requested, transaction.completed, transaction.failed, transaction.compensated para el outbox" "llamada interna | síncrono"

        # --- infrastructure/ implementa puertos de application/ (dependencia hacia adentro) ---
        bankusac.transaction.repo_impl -> bankusac.transaction.port_repo "implementa" "interfaz"
        bankusac.transaction.pub_adapter -> bankusac.transaction.port_publisher "implementa" "interfaz"

        # --- infrastructure/ <-> base de datos y broker ---
        bankusac.transaction.repo_impl -> bankusac.transaction_db "lee/escribe transactions, transaction_events, processed_messages, transaction_aliases y outbox_messages" "TCP/IP | acceso a datos"
        bankusac.transaction.outbox -> bankusac.transaction.port_repo "dispatchPendingOutbox: toma un lote PENDING y lo marca despachado" "llamada interna | síncrono"
        bankusac.transaction.outbox -> bankusac.transaction.broker "publica cada envelope guardado, sin reconstruirlo" "llamada interna | síncrono"
        bankusac.transaction.pub_adapter -> bankusac.transaction.broker "publica lo que no pasa por el outbox: transaction.initiated y las respuestas" "llamada interna | síncrono"
    }

    views {
        component bankusac.transaction "Diagrama_Componentes_Transaction" "Nivel 3 - Transaction Service: interfaces/, application/, domain/, infrastructure/ y el cliente AMQP compartido." {
            include *
            autoLayout tb 650 400
        }

        theme default
        styles {
            element "Container" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Message Broker" {
                shape Pipe
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Database" {
                shape Cylinder
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Interfaces Layer" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Application Layer" {
                background #ffffff
                color #EF9425
                stroke #EF9425
            }
            element "Application Layer Port" {
                shape Component
                background #ffffff
                color #EF9425
                stroke #EF9425
                border dashed
            }
            element "Domain Layer" {
                background #ffffff
                color #398819
                stroke #398819
            }
            element "Infrastructure Layer" {
                background #ffffff
                color #C11926
                stroke #C11926
            }
            element "Shared Package" {
                shape Pipe
                background #ffffff
                color #707070
                stroke #707070
                border dashed
            }
            relationship "Relationship" {
                color #707070
            }
        }
    }
}
