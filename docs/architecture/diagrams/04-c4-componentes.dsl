workspace "Bank USAC - Transaction Service (Componentes)" "Diagrama de Componentes (C4 Nivel 3) del Transaction Service. Microservicio descompuesto: Transaction Service, orquestador de la Saga de transferencia." {

    !identifiers hierarchical

    model {
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido." {
            transaction_db = container "Transaction DB" "Base exclusiva de Transaction Service." "PostgreSQL" "Database"
            transaction = container "Transaction Service" "Orquestación de transferencias, validación de fondos y Saga." "NestJS" "Server-Side Application" {
                # --- interfaces/ ---
                h_transfer = component "TransferRequestedHandler" "Consume transfer.requested | AMQP | comando" "Consumer AMQP" "Interfaces Layer"
                h_status = component "TransactionStatusRequestedHandler" "Consume transaction.status.requested | AMQP | comando" "Consumer AMQP" "Interfaces Layer"
                h_list = component "TransactionListQueryHandler" "Consume transaction.list.query | AMQP | consulta" "Consumer AMQP" "Interfaces Layer"
                h_stats = component "TransactionStatsQueryHandler" "Consume transaction.stats.query | AMQP | consulta" "Consumer AMQP" "Interfaces Layer"
                h_kyc_checked = component "CustomerKycCheckedHandler" "Consume customer.kyc.checked | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_debited = component "AccountDebitedHandler" "Consume account.debited | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_debit_rejected = component "AccountDebitRejectedHandler" "Consume account.debit.rejected | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_paid = component "PaymentSucceededHandler" "Consume payment.succeeded | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_pay_failed = component "PaymentFailedHandler" "Consume payment.failed | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_attempt_failed = component "PaymentAttemptFailedHandler" "Consume payment.attempt.failed | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_credited = component "AccountCreditedHandler" "Consume account.credited | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_credit_rejected = component "AccountCreditRejectedHandler" "Consume account.credit.rejected | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                h_compensated = component "AccountDebitCompensatedHandler" "Consume account.debit.compensated | AMQP | evento" "Consumer AMQP" "Interfaces Layer"
                health = component "HealthController" "Health/readiness checks | HTTP | síncrono" "HTTP Controller" "Interfaces Layer"
                
                # --- domain/ ---
                txEntity = component "Transaction" "PENDING/DEBITING/PAYMENT_PENDING/COMPLETED/FAILED/COMPENSATED;" "Entidad + Máquina de Estados" "Domain Layer"
                
                # --- application/ ---
                uc_request_transfer = component "RequestTransferUseCase" "Abre la Saga: crea Transaction en PENDING" "Caso de uso" "Application Layer"
                uc_get_status = component "GetTransactionStatusUseCase" "Responde transaction.status.replied" "Caso de uso" "Application Layer"
                uc_list_tx = component "ListTransactionsUseCase" "Consulta historial con filtros (cuenta, estado, fechas)" "Caso de uso" "Application Layer"
                uc_get_stats = component "GetTransactionStatsUseCase" "Métricas y volumen para el monitor de la Saga" "Caso de uso" "Application Layer"
                uc_record_attempt = component "RecordPaymentAttemptUseCase" "Registra intentos de la escalera de reintentos" "Caso de uso" "Application Layer"
                saga = component "SagaCoordinator" "Reacciona a eventos de KYC, Account y Payment; decide siguiente paso o compensación" "Handlers de la Saga" "Application Layer"
                port_repo = component "TransactionRepositoryPort" "Contrato de persistencia de Transaction" "Puerto (interfaz)" "Application Layer Port"
                port_publisher = component "EventPublisherPort" "Contrato de publicación de comandos/eventos" "Puerto (interfaz)" "Application Layer Port"

                # --- infrastructure/ ---
                pub_adapter = component "RabbitMqPublisherAdapter" "Implementa EventPublisherPort" "Adaptador de publicación" "Infrastructure Layer"
                sub_adapter = component "RabbitMqConsumerAdapter" "Enruta deliveries a los handlers de interfaces/" "Adaptador de consumo" "Infrastructure Layer"
                amqp = component "AmqpConnectionManager" "Conexión AMQP, ack manual, DLQ" "Integración con el broker" "Infrastructure Layer"
                repo_impl = component "TransactionPostgresRepository" "Implementa TransactionRepositoryPort sobre PostgreSQL" "Adaptador de persistencia" "Infrastructure Layer"
                outbox_relay = component "OutboxRelay" "Barrido periódico que lee eventos pendientes del outbox y los publica en RabbitMQ (TD-031)" "Outbox Scheduler" "Infrastructure Layer"
            }
            rabbitmq = container "RabbitMQ" "Broker central de mensajería asíncrona, fuera de kind." "RabbitMQ 4.3.4-management / AMQP" "Message Broker"
        }

        # --- interfaces/ -> application/ ---
        bankusac.transaction.h_transfer -> bankusac.transaction.uc_request_transfer "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_status -> bankusac.transaction.uc_get_status "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_list -> bankusac.transaction.uc_list_tx "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_stats -> bankusac.transaction.uc_get_stats "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_kyc_checked -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_debited -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_debit_rejected -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_paid -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_pay_failed -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_attempt_failed -> bankusac.transaction.uc_record_attempt "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_credited -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_credit_rejected -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"
        bankusac.transaction.h_compensated -> bankusac.transaction.saga "invoca" "llamada interna | síncrono"

        # --- application/ -> domain/ ---
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.txEntity "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.txEntity "aplica transición válida" "llamada interna | síncrono"

        # --- application/ -> puertos (application/) ---
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.port_repo "persiste transacción" "llamada interna | síncrono"
        bankusac.transaction.uc_request_transfer -> bankusac.transaction.port_publisher "publica customer.kyc.check.requested" "llamada interna | síncrono"
        bankusac.transaction.uc_get_status -> bankusac.transaction.port_repo "lee transacción" "llamada interna | síncrono"
        bankusac.transaction.uc_get_status -> bankusac.transaction.port_publisher "publica transaction.status.replied" "llamada interna | síncrono"
        bankusac.transaction.uc_list_tx -> bankusac.transaction.port_repo "consulta transacciones con filtros" "llamada interna | síncrono"
        bankusac.transaction.uc_list_tx -> bankusac.transaction.port_publisher "publica transaction.list.replied" "llamada interna | síncrono"
        bankusac.transaction.uc_get_stats -> bankusac.transaction.port_repo "agrega estadísticas" "llamada interna | síncrono"
        bankusac.transaction.uc_get_stats -> bankusac.transaction.port_publisher "publica transaction.stats.replied" "llamada interna | síncrono"
        bankusac.transaction.uc_record_attempt -> bankusac.transaction.port_repo "persiste intento fallido" "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.port_repo "persiste transición" "llamada interna | síncrono"
        bankusac.transaction.saga -> bankusac.transaction.port_publisher "publica account.debit.requested, payment.requested, account.credit.requested, account.debit.compensation.requested, transaction.completed, transaction.failed, transaction.compensated" "llamada interna | síncrono"

        # --- infrastructure/ implementa puertos de application/ (dependencia hacia adentro) ---
        bankusac.transaction.repo_impl -> bankusac.transaction.port_repo "implementa" "interfaz"
        bankusac.transaction.pub_adapter -> bankusac.transaction.port_publisher "implementa" "interfaz"

        # --- infrastructure/ <-> broker y base de datos ---
        bankusac.transaction.repo_impl -> bankusac.transaction_db "lee/escribe tabla transactions y outbox" "TCP/IP | acceso a datos"
        bankusac.transaction.pub_adapter -> bankusac.transaction.amqp "usa conexión" "llamada interna"
        bankusac.transaction.sub_adapter -> bankusac.transaction.amqp "usa conexión" "llamada interna"
        bankusac.transaction.outbox_relay -> bankusac.transaction.repo_impl "lee mensajes pendientes" "llamada interna"
        bankusac.transaction.outbox_relay -> bankusac.transaction.amqp "publica periódicamente a RabbitMQ" "llamada interna"
        bankusac.transaction.amqp -> bankusac.rabbitmq "conexión AMQP, ack manual, DLQ" "AMQP | conexión"
        bankusac.transaction.pub_adapter -> bankusac.rabbitmq "publica comandos/eventos" "AMQP | comandos/eventos | correlationId"
        bankusac.transaction.rabbitmq -> bankusac.transaction.sub_adapter "entrega comandos/eventos" "AMQP | comandos/eventos | correlationId"

        # --- infrastructure/ -> interfaces/ (enrutamiento de deliveries) ---
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_transfer "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_status "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_list "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_stats "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_kyc_checked "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_debited "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_debit_rejected "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_paid "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_pay_failed "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_attempt_failed "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_credited "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_credit_rejected "enruta por messageType" "llamada interna | síncrono"
        bankusac.transaction.sub_adapter -> bankusac.transaction.h_compensated "enruta por messageType" "llamada interna | síncrono"
    }

    views {
        component bankusac.transaction "Diagrama_Componentes_Transaction" "Nivel 3 - Transaction Service: interfaces/, application/, domain/, infrastructure/." {
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
            relationship "Relationship" {
                color #707070
            }
        }
    }
}