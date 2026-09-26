workspace "Bank USAC - Diagrama de Contexto (C4 Nivel 1)" "Diagrama de Contexto de Bank USAC. Muestra a los usuarios, el API Gateway como punto de entrada, el núcleo bancario y los sistemas externos." {

    !identifiers hierarchical

    model {
        # --- ACTORES ---
        cliente = person "Cliente" "Cuentahabiente [CLIENTE]. Opera sobre sus propias cuentas: consulta saldo, transfiere y gestiona datos."
        cajero = person "Cajero Receptor" "Personal en ventanilla [CAJERO_RECEPTOR]. Registra clientes, abre cuentas y transfiere por el cliente presente."
        admin = person "Administrador" "Supervisa el sistema [ADMINISTRADOR]: gestiona roles, activa/desactiva cuentas y consulta la auditoría."

        # --- SISTEMAS EXTERNOS ---
        correo = softwareSystem "Servicio de Correo Electrónico (Resend)" "Entrega al cliente el enlace de activación de cuenta. Por defecto canal simulado."
        proveedor = softwareSystem "Proveedor de Pagos" "Procesa pagos externos. Simulado en Fase 2: responde éxito, fallo o timeout con escalera de reintentos."

        # --- SISTEMA PRINCIPAL ---
        bankusac = softwareSystem "Bank USAC" "Sistema bancario distribuido." {
            gateway = container "API Gateway" "Único punto de entrada. Autentica con JWT, autoriza por rol y traduce peticiones HTTP a mensajes AMQP. Sin lógica de negocio ni base de datos." "NestJS" "Entrypoint"
            core = container "Núcleo Bancario Bank USAC" "Conjunto de microservicios de dominio: Customer, Account, Transaction, Payment y Notification & Audit. Comunica exclusivamente por AMQP." "Microservices" "Core"
        }

        # --- RELACIONES ---
        cliente -> bankusac.gateway "Consulta y gestiona sus cuentas" "HTTPS / REST · síncrono"
        cajero -> bankusac.gateway "Atiende clientes en ventanilla" "HTTPS / REST · síncrono"
        admin -> bankusac.gateway "Supervisa cuentas y auditoría" "HTTPS / REST · síncrono"

        bankusac.gateway -> bankusac.core "Publica comandos y consultas con correlationId" "AMQP 0-9-1 · asíncrono"
        bankusac.core -> bankusac.gateway "Responde por cola de respuesta" "AMQP 0-9-1 · request/reply"

        bankusac.core -> correo "Envía el correo de activación" "HTTPS / REST (API de Resend) · síncrono · canal simulado"
        correo -> cliente "Entrega el enlace de activación" "Correo electrónico · asíncrono"

        bankusac.core -> proveedor "Solicita la autorización del pago" "API del proveedor · síncrono · respuesta simulada: éxito / fallo / timeout"
    }

    views {
        container bankusac "Diagrama_Contexto_Gateway" "Diagrama C4 Nivel 1 - Contexto del Sistema con API Gateway" {
            include *
            include correo proveedor
            autoLayout lr 500 300
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
            element "Entrypoint" {
                background #ffffff
                color #1168bd
                stroke #1168bd
            }
            element "Core" {
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
