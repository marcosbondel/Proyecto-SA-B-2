workspace "Bank USAC" "Sistema bancario distribuido para el curso de Software Avanzado." {

    !identifiers hierarchical

    model {
        # --- ACTORES ---
        cliente = person "Cliente" "Rol CLIENTE. Cuentahabiente que consulta saldo, transfiere y gestiona sus datos."
        cajero = person "Cajero Receptor" "Rol CAJERO_RECEPTOR. Personal en ventanilla que atiende a los clientes."
        admin = person "Administrador" "Rol ADMINISTRADOR. Supervisa clientes, cuentas y auditoría."

        # --- SISTEMAS EXTERNOS SIMULADOS ---
        correo = softwareSystem "Servicio de Correo Electrónico (Simulado)" "Entrega el enlace de activación de cuenta. Sistema externo simulado."
        proveedor = softwareSystem "Proveedor de Pagos (Simulado)" "Procesa pagos externos que el banco no resuelve internamente. Sistema externo simulado."

        # --- SISTEMA PRINCIPAL ---
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido. Gestiona clientes, cuentas, transferencias, pagos y auditoría." {

            group "Kubernetes Cluster" {
                frontend = container "Frontend" "Interfaz de los tres actores. No contiene lógica de negocio." "Nuxt 4 + @nuxt/ui" "Web Browser"
                gateway = container "API Gateway" "Único entrypoint. Valida el JWT y traduce HTTP síncrono a mensajes AMQP; sin lógica de negocio ni base de datos." "NestJS" "Server-Side Application"

                customer = container "Customer Service" "Identidad del cliente: registro, validación de identidad y actualización de datos." "NestJS" "Server-Side Application"
                account = container "Account Service" "Cuentas, balances y desactivación de cuentas inactivas." "NestJS" "Server-Side Application"
                transaction = container "Transaction Service" "Gestiona el estado de transferencias mediante una Saga por coreografía." "NestJS" "Server-Side Application"
                payment = container "Payment Service" "Procesamiento de pagos y reintentos." "NestJS" "Server-Side Application"
                notification = container "Notification & Audit Service" "Registro de eventos y notificaciones. Terminal: no publica eventos hacia otros servicios." "NestJS" "Server-Side Application"
            }

            group "Infraestructura externa al Cluster (Docker en el host)" {
                rabbitmq = container "RabbitMQ" "Broker central de mensajería asíncrona, fuera de kind." "RabbitMQ 4.3.4-management / AMQP" "Message Broker"
                customer_db = container "Customer DB" "Base exclusiva de Customer Service." "PostgreSQL" "Database"
                account_db = container "Account DB" "Base exclusiva de Account Service." "PostgreSQL" "Database"
                transaction_db = container "Transaction DB" "Base exclusiva de Transaction Service." "PostgreSQL" "Database"
                payment_db = container "Payment DB" "Base exclusiva de Payment Service." "PostgreSQL" "Database"
                notification_db = container "Notification DB" "Base exclusiva de Notification & Audit Service." "PostgreSQL" "Database"
                minio = container "MinIO" "Búfer S3-compatible para fotografías de identidad; fuera de kind." "MinIO / S3-compatible API" "Object Store"
            }
        }

        # --- RELACIONES RESUMIDAS DEL CONTEXTO ---
        cliente -> bankusac "Accede mediante Frontend y API Gateway" "HTTPS (síncrono) -> AMQP (asíncrono)"
        cajero -> bankusac "Accede mediante Frontend y API Gateway" "HTTPS (síncrono) -> AMQP (asíncrono)"
        admin -> bankusac "Accede mediante Frontend y API Gateway" "HTTPS (síncrono) -> AMQP (asíncrono)"
        bankusac -> correo "Solicita entrega de correo de activación" "External email delivery | simulado"
        bankusac -> proveedor "Procesa pagos externos" "API | solicitud externa | simulado"

        # --- ACTORES Y ENTRYPOINT DEL NIVEL DE CONTENEDORES ---
        cliente -> bankusac.frontend "Interacción de usuario" "UI | interacción de usuario"
        cajero -> bankusac.frontend "Interacción de usuario" "UI | interacción de usuario"
        admin -> bankusac.frontend "Interacción de usuario" "UI | interacción de usuario"
        bankusac.frontend -> bankusac.gateway "Invoca la API" "HTTPS / REST / JSON | request síncrono"

        # --- GATEWAY <-> RABBITMQ ---
        # Detalle de mensajes por canal en message-catalog.md; aquí se agrupan por dirección
        # para que el diagrama de contenedores no repita una flecha por cada tipo de mensaje.
        bankusac.gateway -> bankusac.rabbitmq "Publica comandos y requests: Customer, Account, Transaction y Audit (incluye audit.query.requested)" "AMQP | comando/request | correlationId"
        bankusac.rabbitmq -> bankusac.gateway "Entrega respuestas request/reply: customer.authenticate, account.balance.query y audit.query.replied" "AMQP | respuesta | correlationId"

        # --- RABBITMQ <-> CUSTOMER ---
        bankusac.rabbitmq -> bankusac.customer "Entrega comandos: customer.register, customer.authenticate, customer.verify-email, customer.update, customer.validate-identity" "AMQP | comando/request-reply | correlationId"
        bankusac.customer -> bankusac.rabbitmq "Publica respuestas y eventos: registered, activation.requested, email.verified, identity.*, login.*" "AMQP | evento/respuesta | correlationId"

        # --- RABBITMQ <-> ACCOUNT ---
        bankusac.rabbitmq -> bankusac.account "Entrega comandos: account.create, account.balance.query, account.set-status, y comandos de Saga (debit/credit/compensation)" "AMQP | comando/request-reply | correlationId"
        bankusac.account -> bankusac.rabbitmq "Publica respuesta de balance y eventos de Saga/auditoría: account.debited, account.debit.rejected, account.credited, account.credit.rejected, account.debit.compensated" "AMQP | evento/respuesta | correlationId"

        # --- RABBITMQ <-> TRANSACTION ---
        bankusac.rabbitmq -> bankusac.transaction "Entrega transfer.requested y eventos de Saga de Account/Payment" "AMQP | comando/evento | correlationId"
        bankusac.transaction -> bankusac.rabbitmq "Publica comandos de Saga (debit/credit/compensation), payment.requested y eventos de auditoría" "AMQP | comando/evento | correlationId"

        # --- RABBITMQ <-> PAYMENT ---
        bankusac.rabbitmq -> bankusac.payment "Entrega payment.requested" "AMQP | comando | correlationId"
        bankusac.payment -> bankusac.rabbitmq "Publica payment.succeeded, payment.failed y eventos de auditoría" "AMQP | evento | correlationId"

        # --- AUDITORÍA: DESTINO FINAL ---
        bankusac.rabbitmq -> bankusac.notification "Entrega eventos de bank.events y audit.query.requested para auditoría y consultas" "AMQP | evento/comando | correlationId"
        bankusac.notification -> bankusac.rabbitmq "Publica audit.query.replied" "AMQP | respuesta | correlationId"

        # --- ACTIVACIÓN DE CORREO ---
        bankusac.notification -> correo "Entrega correo de activación" "Email delivery | efecto externo | sistema simulado"

        # --- INTEGRACIÓN EXTERNA DE PAGOS ---
        bankusac.gateway -> bankusac.minio "Escribe fotografía y publica su referencia" "S3-compatible API | síncrono hacia infraestructura"
        bankusac.customer -> bankusac.minio "Lee y verifica fotografía por referencia" "S3-compatible API | síncrono hacia infraestructura"
        bankusac.payment -> proveedor "Solicita procesamiento de pago externo" "External payment API | solicitud externa | simulado"

        # --- BASE DE DATOS POR SERVICIO ---
        bankusac.customer -> bankusac.customer_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.account -> bankusac.account_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.transaction -> bankusac.transaction_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.payment -> bankusac.payment_db "Lee/escribe únicamente su base" "TCP/IP | acceso a datos"
        bankusac.notification -> bankusac.notification_db "Escribe únicamente su base" "TCP/IP | acceso a datos"
    }

    views {
        systemContext bankusac "Diagrama_Contexto" {
            include cliente cajero admin bankusac correo proveedor
            autoLayout lr 450 250
        }

        container bankusac "Diagrama_Contenedores" {
            include cliente cajero admin
            include bankusac.frontend bankusac.gateway
            include bankusac.customer bankusac.account bankusac.transaction bankusac.payment bankusac.notification
            include bankusac.rabbitmq
            include bankusac.customer_db bankusac.account_db bankusac.transaction_db bankusac.payment_db bankusac.notification_db
            include bankusac.minio
            include correo proveedor
            autoLayout tb 650 400
        }

        dynamic bankusac "Flujo_Saga_Transferencia_Exitoso" "Camino feliz de una transferencia entre cuentas (patrón Saga)." {
            cliente -> bankusac.frontend "1. Solicita transferencia"
            bankusac.frontend -> bankusac.gateway "2. POST /transfers"
            bankusac.gateway -> bankusac.rabbitmq "3. Publica transfer.requested"
            bankusac.rabbitmq -> bankusac.transaction "4. Entrega transfer.requested"
            bankusac.transaction -> bankusac.rabbitmq "5. Publica account.debit.requested"
            bankusac.rabbitmq -> bankusac.account "6. Entrega account.debit.requested"
            bankusac.account -> bankusac.rabbitmq "7. Publica account.debited"
            bankusac.rabbitmq -> bankusac.transaction "8. Entrega account.debited"
            bankusac.transaction -> bankusac.rabbitmq "9. Publica payment.requested"
            bankusac.rabbitmq -> bankusac.payment "10. Entrega payment.requested"
            bankusac.payment -> proveedor "11. Procesa pago externo"
            bankusac.payment -> bankusac.rabbitmq "12. Publica payment.succeeded"
            bankusac.rabbitmq -> bankusac.transaction "13. Entrega payment.succeeded"
            bankusac.transaction -> bankusac.rabbitmq "14. Publica account.credit.requested"
            bankusac.rabbitmq -> bankusac.account "15. Entrega account.credit.requested"
            bankusac.account -> bankusac.rabbitmq "16. Publica account.credited"
            bankusac.rabbitmq -> bankusac.transaction "17. Entrega account.credited"
            bankusac.transaction -> bankusac.rabbitmq "18. Publica transaction.completed"
            bankusac.rabbitmq -> bankusac.notification "19. Consume eventos para auditoría"
            autoLayout lr 450 250
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
                color #EF9425
                stroke #EF9425
            }
            element "Container" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Boundary" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Group" {
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Group:Kubernetes Cluster" {
                color #1168BD
                stroke #1168BD
            }
            element "Group:Infraestructura externa al Cluster (Docker en el host)" {
                color #707070
                stroke #707070
            }
            element "Web Browser" {
                shape WebBrowser
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Server-Side Application" {
                shape Component
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
            element "Object Store" {
                shape Cylinder
                background #ffffff
                color #1168BD
                stroke #1168BD
            }
            element "Existing System" {
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
