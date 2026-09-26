# C4 Nivel 3 — Diagrama de Componentes

Este documento describe el **Nivel 3 (Componentes)** de la arquitectura C4 para **Bank USAC**, exponiendo la estructura interna de los microservicios bajo los principios de **Arquitectura Hexagonal / Clean Architecture**.

---

## 1. Diagrama de Componentes

![C4 Componentes — Bank USAC](diagrams/04-c4-componentes.png)

Fuentes de diagramación versionadas:
* [Structurizr DSL (`.dsl`)](diagrams/04-c4-componentes.dsl)

---

## 2. Capas Arquitectónicas Internas

Cada servicio de dominio está estructurado internamente en cuatro capas estrictas con control de dependencias unidireccional hacia el núcleo:

```mermaid
flowchart TD
    subgraph Microservicio ["Arquitectura Hexagonal / Clean Architecture"]
        direction TB
        INT["Interfaces<br/>(Controllers / Consumers / Handlers)"]
        APP["Application<br/>(Use Cases / Sagas / Orchestrators)"]
        DOM["Domain (Núcleo Puro de Negocio)<br/>(Entities / Value Objects / Domain Events)"]
        INF["Infrastructure<br/>(Repositories / Broker Adapters / Schedulers)"]

        INT -->|Llama casos de uso| APP
        APP -->|Ejecuta lógica pura| DOM
        INF -.->|Implementa puertos de| DOM
        INF -.->|Inyectado como dependencias en| APP
    end
```


1. **Domain (`domain/`)**:
   * Núcleo puro de negocio, independiente de frameworks, bases de datos o transporte.
   * Contiene entidades ricas (`Customer`, `Account`, `Transaction`, `Payment`), objetos de valor inmutables (`Money`, `Email`, `DocumentNumber`) y reglas de transición de estados.
2. **Application (`application/`)**:
   * Casos de uso (`Use Cases`) y orquestación de comandos.
   * Gestiona límites transaccionales, publicación de eventos y políticas de compensación.
3. **Infrastructure (`infrastructure/`)**:
   * Implementaciones concretas de puertos: adaptadores PostgreSQL (`pg`), adaptadores de mensajería RabbitMQ (`amqp`), clientes HTTP externos y schedulers cron con relojes inyectados.
4. **Interfaces (`interfaces/`)**:
   * Controladores REST (en el API Gateway) y manejadores de mensajes / consumidores de colas RabbitMQ (en los microservicios).
