# Casos de uso de Bank USAC

Esta carpeta usa tres niveles de lectura:

1. `00-alto-nivel`: el sistema se observa como un único núcleo de operaciones
   bancarias y se relaciona con sus actores principales.
2. `01-primera-descomposicion`: el núcleo se divide en las cinco áreas
   funcionales que corresponden a los cinco microservicios del dominio.
3. Cada subcarpeta contiene el diagrama de casos de uso de su microservicio y
   una vista de actividad de sus flujos principales.

## Qué significa cada tipo de diagrama

- Un **diagrama de casos de uso** muestra objetivos observables para un actor.
  `<<include>>` se usa únicamente para comportamiento obligatorio reutilizado y
  `<<extend>>` para comportamiento opcional o alternativo.
- La primera descomposición se expresa por contención funcional, no usando
  `<<include>>` entre los cinco microservicios. Una operación bancaria no
  ejecuta necesariamente todos los módulos.
- Un **diagrama de actividad** muestra el flujo principal, decisiones y errores
  de un conjunto de funcionalidades. No sustituye al diagrama de casos de uso.

PlantUML contiene la notación UML nativa. Mermaid es la representación
versionable aproximada exigida por ADR-013.

## Fuente funcional

Los casos se derivan de:

- `docs/domain/actors.md` — actores y permisos.
- `docs/domain/use-cases.md` — seis flujos de negocio y la Saga.
- `docs/domain/message-catalog.md` — comandos y eventos por servicio.
- `docs/domain/bounded-contexts.md` — responsabilidades y límites.
- `docs/design-docs/PROMPT_MOCKUP.MD` — superficies funcionales del frontend,
  solamente cuando no contradicen el modelo de dominio.

No se modelan depósitos ni retiros de efectivo: el propio modelo los deja fuera
de alcance. La validación de fondos pertenece a Account Service; Transaction
Service solicita esa validación y conserva el estado de la Saga.

## Estructura

```text
cdu/
├── 00-alto-nivel.{puml,mmd}
├── 01-primera-descomposicion.{puml,mmd}
├── customer/
│   ├── customer-casos-de-uso.{puml,mmd}
│   └── flujos.{puml,mmd}
├── account/
│   ├── account-casos-de-uso.{puml,mmd}
│   └── flujos.{puml,mmd}
├── transaction/
│   ├── transaction-casos-de-uso.{puml,mmd}
│   └── flujos.{puml,mmd}
├── payment/
│   ├── payment-casos-de-uso.{puml,mmd}
│   └── flujos.{puml,mmd}
└── notification-audit/
    ├── notification-audit-casos-de-uso.{puml,mmd}
    └── flujos.{puml,mmd}
```

