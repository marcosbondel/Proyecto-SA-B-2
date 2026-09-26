workspace "Bank USAC - Diagrama de Contenedores (C4 Nivel 2)" "Diagrama de Contenedores de Bank USAC. Arquitectura de microservicios, broker RabbitMQ, almacenamiento MinIO y bases de datos PostgreSQL." {

    !identifiers hierarchical

    model {
        # --- ACTORES ---
        cliente = person "Cliente" "Rol CLIENTE: consulta saldo, transfiere y gestiona sus datos."
        cajero = person "Cajero Receptor" "Rol CAJERO_RECEPTOR: atiende clientes en ventanilla."
        admin = person "Administrador" "Rol ADMINISTRADOR: supervisa clientes, cuentas y auditoría."

        # --- SISTEMAS EXTERNOS SIMULADOS ---
        correo = softwareSystem "Servicio de Correo Electrónico (Simulado)" "Entrega el enlace de activación de cuenta."
        proveedor = softwareSystem "Proveedor de Pagos (Simulado)" "Procesa pagos externos simulados (SUCCESS/FAILURE/TIMEOUT)."

        # --- SISTEMA PRINCIPAL ---
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido." {

            group "Kubernetes Cluster" {
                frontend = container "Frontend" "Interfaz de los tres actores; sin lógica de negocio." "Nuxt 4 + @nuxt/ui" "Web Browser"
                gateway = container "API Gateway" "Único entrypoint; valida JWT, traduce HTTP a AMQP y no tiene BD." "NestJS" "Server-Side Application"

                customer = container "Customer Service" "Identidad del cliente y estado KYC (PENDING/VERIFIED/REJECTED); responde el gate que autoriza transferir." "NestJS" "Server-Side Application"
                account = container "Account Service" "Cuentas y balances. Tipos MONETARIA y AHORRO con saldo mínimo de apertura y comisión por débito." "NestJS" "Server-Side Application"
                transaction = container "Transaction Service" "Orquestación de la Saga e historial con filtros por cuenta, estado y fecha." "NestJS" "Server-Side Application"
                payment = container "Payment Service" "Pagos externos simulados (SUCCESS/FAILURE/TIMEOUT) y escalera de reintentos." "NestJS" "Server-Side Application"
                notification = container "Notification & Audit Service" "Clasifica cada evento INFO/WARNING/ERROR, notifica según tipo y guarda el historial; terminal." "NestJS" "Server-Side Application"
            }

            group "Infraestructura externa al cluster: Docker en el host" {
                rabbitmq = container "RabbitMQ" "Broker central de mensajería asíncrona, fuera de kind." "RabbitMQ 4.3.4-management / AMQP" "Message Broker"
                customer_db = container "Customer DB" "Base exclusiva de Customer Service." "PostgreSQL" "Database"
                account_db = container "Account DB" "Base exclusiva de Account Service." "PostgreSQL" "Database"
                transaction_db = container "Transaction DB" "Base exclusiva de Transaction Service." "PostgreSQL" "Database"
                payment_db = container "Payment DB" "Base exclusiva de Payment Service." "PostgreSQL" "Database"
                notification_db = container "Notification DB" "Base exclusiva de Notification & Audit Service." "PostgreSQL" "Database"
                minio = container "MinIO" "Búfer externo para fotografías de identidad; la fuente de verdad permanece en Customer Service." "MinIO / S3-compatible API" "Object Store"
            }
        }

        # --- RELACIONES ---
        cliente -> bankusac.frontend "Interacción de usuario" "UI"
        cajero -> bankusac.frontend "Interacción de usuario" "UI"
        admin -> bankusac.frontend "Interacción de usuario" "UI"
        bankusac.frontend -> bankusac.gateway "Frontend -> API Gateway" "HTTPS/REST/JSON | request síncrono"

        # Gateway <-> RabbitMQ
        bankusac.gateway -> bankusac.rabbitmq "Publica comandos de Customer y Account" "AMQP | comando/request-reply | correlationId"
        bankusac.rabbitmq -> bankusac.customer "Gateway -> Customer: customer.register, customer.authenticate (request/reply), customer.verify-email, customer.update, customer.validate-identity" "AMQP | comando/request-reply | correlationId"
        bankusac.customer -> bankusac.rabbitmq "Publica respuesta customer.authenticate" "AMQP | request-reply | correlationId"
        bankusac.rabbitmq -> bankusac.gateway "Customer -> Gateway: customer.authenticate (request/reply)" "AMQP | respuesta | correlationId"

        bankusac.rabbitmq -> bankusac.account "Gateway -> Account: account.create, account.balance.query (request/reply), account.set-status" "AMQP | comando/request-reply | correlationId"
        bankusac.account -> bankusac.rabbitmq "Publica respuesta account.balance.query" "AMQP | request-reply | correlationId"
        bankusac.rabbitmq -> bankusac.gateway "Account -> Gateway: account.balance.query (request/reply)" "AMQP | respuesta | correlationId"

        bankusac.gateway -> bankusac.rabbitmq "Publica transfer.requested" "AMQP | comando | correlationId"
        bankusac.rabbitmq -> bankusac.transaction "Gateway -> Transaction: transfer.requested" "AMQP | comando | correlationId"

        # Gate KYC: Transaction <-> Customer
        bankusac.transaction -> bankusac.rabbitmq "Publica customer.kyc.check.requested (Gate KYC)" "AMQP | comando | correlationId"
        bankusac.rabbitmq -> bankusac.customer "Transaction -> Customer: customer.kyc.check.requested" "AMQP | comando | correlationId"
        bankusac.customer -> bankusac.rabbitmq "Publica customer.kyc.checked (veredicto KYC)" "AMQP | evento | correlationId"
        bankusac.rabbitmq -> bankusac.transaction "Customer -> Transaction: customer.kyc.checked" "AMQP | evento | correlationId"

        # Saga: Transaction <-> Account
        bankusac.transaction -> bankusac.rabbitmq "Publica account.debit.requested, account.credit.requested, account.debit.compensation.requested" "AMQP | comandos | correlationId"
        bankusac.rabbitmq -> bankusac.account "Transaction -> Account: account.debit.requested, account.credit.requested, account.debit.compensation.requested" "AMQP | comandos | correlationId"
        bankusac.account -> bankusac.rabbitmq "Publica account.debited, account.debit.rejected, account.credited, account.credit.rejected, account.debit.compensated" "AMQP | eventos | correlationId"
        bankusac.rabbitmq -> bankusac.transaction "Account -> Transaction: account.debited, account.debit.rejected, account.credited, account.credit.rejected, account.debit.compensated" "AMQP | eventos | correlationId"

        # Saga: Transaction <-> Payment
        bankusac.transaction -> bankusac.rabbitmq "Publica payment.requested" "AMQP | comando | correlationId"
        bankusac.rabbitmq -> bankusac.payment "Transaction -> Payment: payment.requested" "AMQP | comando | correlationId"
        bankusac.payment -> bankusac.rabbitmq "Publica payment.attempt.failed (uno por intento fallido, no terminal), payment.succeeded, payment.failed" "AMQP | eventos | correlationId"
        bankusac.rabbitmq -> bankusac.transaction "Payment -> Transaction: payment.attempt.failed (uno por intento fallido, no terminal), payment.succeeded, payment.failed" "AMQP | eventos | correlationId"

        # Eventos globales hacia RabbitMQ
        bankusac.customer -> bankusac.rabbitmq "Publica customer.registered, activation.requested, email.verified, identity.* y login.*" "AMQP | eventos | correlationId"
        bankusac.account -> bankusac.rabbitmq "Publica account.*" "AMQP | eventos | correlationId"
        bankusac.transaction -> bankusac.rabbitmq "Publica transaction.*" "AMQP | eventos | correlationId"
        bankusac.payment -> bankusac.rabbitmq "Publica payment.*" "AMQP | eventos | correlationId"
        bankusac.rabbitmq -> bankusac.notification "Entrega todos los eventos de bank.events para auditoría y notificaciones" "AMQP | eventos | correlationId"

        # Efectos externos e infraestructura
        bankusac.notification -> correo "Entrega correo de activación" "Email delivery | efecto externo | simulado"
        bankusac.payment -> proveedor "Solicita procesamiento de pago externo" "External payment API | solicitud externa | simulado"
        bankusac.gateway -> bankusac.minio "Escribe fotografía y publica referencia" "S3-compatible API | infraestructura externa"
        bankusac.customer -> bankusac.minio "Lee y verifica fotografía por referencia" "S3-compatible API | infraestructura externa"

        # Bases de datos dedicadas
        bankusac.customer -> bankusac.customer_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.account -> bankusac.account_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.transaction -> bankusac.transaction_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.payment -> bankusac.payment_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.notification -> bankusac.notification_db "Escribe únicamente su base" "TCP/IP | acceso a datos"
    }

    views {
        container bankusac "Diagrama_Contenedores" "Diagrama C4 Nivel 2 - Contenedores de Bank USAC" {
            include *
            autoLayout lr 600 350
        }

        theme default
        styles {
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
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            element "Message Broker" {
                shape Pipe
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            element "Object Store" {
                shape Folder
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            element "Web Browser" {
                shape WebBrowser
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            relationship "Relationship" {
                color #707070
            }
        }
    }
}
