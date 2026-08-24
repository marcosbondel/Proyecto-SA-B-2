workspace "Bank USAC" "Sistema bancario distribuido para el curso de Software Avanzado." {

    !identifiers hierarchical

    model {
        # --- ACTORES ---
        cliente = person "Cliente [CLIENTE]" "Cuentahabiente. Opera sobre sus propias cuentas: consulta saldo, transfiere y gestiona datos." "Person"
        cajero = person "Cajero Receptor [CAJERO_RECEPTOR]" "Personal en ventanilla. Registra clientes, abre cuentas y transfiere." "Person"
        admin = person "Administrador [ADMINISTRADOR]" "Supervisa: gestiona roles, activa/desactiva cuentas y consulta auditoría." "Person"

        # --- SISTEMAS EXTERNOS ---
        correo = softwareSystem "Servicio de Correo Electrónico" "Entrega al cliente el enlace de activación de cuenta." "Existing System"
        proveedor = softwareSystem "Proveedor de Pagos" "Procesa pagos externos que el banco no resuelve internamente." "Existing System"

        # --- SISTEMA PRINCIPAL (Bank USAC) ---
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido. Gestiona clientes, cuentas, transferencias, pagos y auditoría." {
            
            group "Kubernetes Cluster" {
                frontend = container "Frontend Web" "Único cliente externo del Gateway; custodia el JWT de sesión." "Nuxt 4 + Vue 3 + @nuxt/ui" "Web Browser"
                gateway = container "API Gateway" "ÚNICO punto de entrada al sistema. Autentica y traduce HTTP síncrono a asíncrono. Sin BD." "NestJS" "Server-Side Application"
                rabbitmq = container "Message Broker" "Columna vertebral de mensajería asíncrona." "RabbitMQ" "Server-Side Application"

                customer = container "Customer Service" "Identidad del cliente." "NestJS" "Server-Side Application"
                account = container "Account Service" "Cuentas y balances." "NestJS" "Server-Side Application"
                transaction = container "Transaction Service" "Orquestación de transacciones." "NestJS" "Server-Side Application"
                payment = container "Payment Service" "Procesamiento de pagos y reintentos." "NestJS" "Server-Side Application"
                notification = container "Notification & Audit" "Notificaciones y auditoría (terminal internamente)." "NestJS" "Server-Side Application"
            }

            group "Bases de Datos (Externas al Cluster)" {
                customer_db = container "Customer DB" "Base de datos exclusiva." "PostgreSQL" "Database"
                account_db = container "Account DB" "Base de datos exclusiva." "PostgreSQL" "Database"
                transaction_db = container "Transaction DB" "Base de datos exclusiva." "PostgreSQL" "Database"
                payment_db = container "Payment DB" "Base de datos exclusiva." "PostgreSQL" "Database"
                notification_db = container "Notification DB" "Base de datos exclusiva." "PostgreSQL" "Database"
            }
        }

        # --- RELACIONES DEL NIVEL 1 (CONTEXTO) ---
        cliente -> bankusac "Consulta y gestiona sus cuentas" "HTTPS"
        cajero -> bankusac "Atiende clientes en ventanilla" "HTTPS"
        admin -> bankusac "Supervisa cuentas y auditoría" "HTTPS"
        
        bankusac -> correo "Solicita correo de activación" "SMTP"
        correo -> cliente "Entrega enlace de activación" "Correo electrónico"
        bankusac -> proveedor "Procesa pagos externos" "API"

        # --- RELACIONES DEL NIVEL 2 (CONTENEDORES) ---
        cliente -> bankusac.frontend "Consulta y gestiona sus cuentas" "HTTPS"
        cajero -> bankusac.frontend "Atiende clientes en ventanilla" "HTTPS"
        admin -> bankusac.frontend "Supervisa cuentas y auditoría" "HTTPS"

        bankusac.frontend -> bankusac.gateway "Consume la API REST portando el JWT (Síncrono)" "HTTPS / REST / JSON"

        # Gateway a Microservicios
        bankusac.gateway -> bankusac.customer "Delega identidad" "AMQP | cmd: customer.register, verify-email, update, validate-identity | req/rep: authenticate"
        bankusac.gateway -> bankusac.account "Delega cuentas" "AMQP | cmd: account.create, set-status | req/rep: balance.query"
        bankusac.gateway -> bankusac.transaction "Delega transferencias" "AMQP | cmd: transfer.requested"

        # Sagas y coreografía
        bankusac.transaction -> bankusac.account "Solicita afectación de saldo" "AMQP | cmd: debit.requested, credit.requested, debit.compensation.requested"
        bankusac.account -> bankusac.transaction "Emite resultado de afectación" "AMQP | ev: debited, debit.rejected, credited, credit.rejected, debit.compensated"
        
        bankusac.transaction -> bankusac.payment "Solicita procesamiento de pago" "AMQP | cmd: payment.requested"
        bankusac.payment -> bankusac.transaction "Emite estado de pago" "AMQP | ev: payment.succeeded, payment.failed"

        # Auditoría terminal
        bankusac.gateway -> bankusac.notification "Emite auditoría" "AMQP | evento"
        bankusac.customer -> bankusac.notification "Emite auditoría" "AMQP | evento"
        bankusac.account -> bankusac.notification "Emite auditoría" "AMQP | evento"
        bankusac.transaction -> bankusac.notification "Emite auditoría" "AMQP | evento"
        bankusac.payment -> bankusac.notification "Emite auditoría" "AMQP | evento"

        # Microservicios a Bases de Datos
        bankusac.customer -> bankusac.customer_db "Lee/Escribe" "TCP/IP"
        bankusac.account -> bankusac.account_db "Lee/Escribe" "TCP/IP"
        bankusac.transaction -> bankusac.transaction_db "Lee/Escribe" "TCP/IP"
        bankusac.payment -> bankusac.payment_db "Lee/Escribe" "TCP/IP"
        bankusac.notification -> bankusac.notification_db "Escribe" "TCP/IP"

        # Microservicios a Sistemas Externos
        bankusac.payment -> proveedor "Procesa pagos externos" "API"
        bankusac.notification -> correo "Solicita correo de activación" "SMTP"
    }

    views {
        systemContext bankusac "Diagrama_Contexto" {
            include *
            autoLayout
        }

        container bankusac "Diagrama_Contenedores" {
            include *
            autoLayout
        }

        # Paleta del ejemplo oficial actual: fondo blanco y contornos/textos por categoría.
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
            element "Database" {
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
