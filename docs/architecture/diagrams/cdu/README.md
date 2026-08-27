# Casos de uso de Bank USAC

La carpeta sigue la forma solicitada por el auxiliar. No se modelan tres o más
descomposiciones anidadas: el microservicio aparece como una función principal
del sistema y, dentro de esa función, se enumeran sus funcionalidades como
casos de uso relacionados.

## Lectura de los diagramas

1. `00-alto-nivel` muestra `CDU000`, el objetivo general de Bank USAC.
2. `01-primera-descomposicion` muestra `CDU001` a `CDU005`. Cada uno representa
   la función principal de un microservicio.
3. Cada carpeta de microservicio contiene un diagrama detallado. Sus casos
   siguen la numeración del CDU principal: `CDU001.1`, `CDU001.2`, etc.
4. `flujos/` contiene diagramas de actividad para los casos de uso principales.
   Los comportamientos incluidos, como validar credenciales o persistir una
   auditoría, se muestran dentro del caso principal que los reutiliza.

La numeración no debe interpretarse como `CDU001.1.1`: no existe una tercera
descomposición. Los sufijos identifican funcionalidades del CDU del
microservicio.

## Matriz de CDUs

| CDU | Función principal | Microservicio |
| --- | --- | --- |
| CDU000 | Gestionar operaciones bancarias | Bank USAC |
| CDU001 | Gestionar clientes e identidad | Customer Service |
| CDU002 | Gestionar cuentas y saldos | Account Service |
| CDU003 | Gestionar transferencias | Transaction Service |
| CDU004 | Gestionar pagos | Payment Service |
| CDU005 | Gestionar notificaciones y auditoría | Notification & Audit Service |

## Funcionalidades principales

- `CDU001`: registrar cliente, activar cliente por correo, iniciar sesión,
  actualizar datos, cargar fotografía y validar identidad.
- `CDU002`: abrir cuenta, consultar saldo, aplicar movimiento de Saga y
  gestionar estado de cuenta.
- `CDU003`: transferir fondos y consultar el estado de una transferencia.
- `CDU004`: procesar pagos y consultar el historial de pagos.
- `CDU005`: registrar auditoría, enviar notificaciones y consultar auditoría o
  notificaciones.

## Qué significa cada notación

- Un **diagrama de casos de uso** muestra objetivos y funcionalidades asociadas
  con actores. `<<include>>` representa comportamiento obligatorio reutilizado;
  `<<extend>>` representa comportamiento opcional o alternativo.
- Un **diagrama de actividad** muestra el flujo principal, decisiones, errores
  y resultados de un caso de uso. Es el equivalente a los diagramas de flujo
  mostrados en clase.
- PlantUML contiene la notación UML nativa. Mermaid es la representación
  versionable aproximada exigida por ADR-013; en `flujos/`, los PNG se generan
  desde los archivos `.mmd` de Mermaid y los `.puml` se conservan como fuente
  UML alternativa.

## Fuente funcional

Los casos se derivan de:

- `docs/domain/actors.md` — actores y permisos.
- `docs/domain/use-cases.md` — seis flujos de negocio y la Saga.
- `docs/domain/message-catalog.md` — comandos y eventos por servicio.
- `docs/domain/bounded-contexts.md` — responsabilidades y límites.
- `docs/design-docs/PROMPT_MOCKUP.MD` — superficies funcionales del frontend,
  solamente cuando no contradicen el modelo de dominio.

No se modelan depósitos ni retiros de efectivo: el modelo del proyecto los deja
fuera de alcance. La validación de fondos pertenece a Account Service;
Transaction Service solicita el movimiento y conserva el estado de la Saga.

## Estructura

```text
cdu/
├── 00-alto-nivel.{puml,mmd,png}
├── 01-primera-descomposicion.{puml,mmd,png}
├── customer/
│   ├── customer-casos-de-uso.{puml,mmd,png}
│   └── flujos/
│       ├── CDU001.1-registrar-cliente.{puml,mmd,png}
│       ├── CDU001.2-activar-cliente.{puml,mmd,png}
│       ├── CDU001.3-iniciar-sesion.{puml,mmd,png}
│       ├── CDU001.4-actualizar-datos.{puml,mmd,png}
│       ├── CDU001.5-cargar-fotografia.{puml,mmd,png}
│       └── CDU001.6-validar-identidad.{puml,mmd,png}
├── account/flujos/ (CDU002.1 a CDU002.4)
├── transaction/flujos/ (CDU003.1 y CDU003.2)
├── payment/flujos/ (CDU004.1 y CDU004.2)
└── notification-audit/flujos/ (CDU005.1 a CDU005.4)
```

Las carpetas `account/flujos/`, `transaction/flujos/`, `payment/flujos/` y
`notification-audit/flujos/` siguen la misma convención: cada flujo dispone de
su fuente `.mmd`, su fuente `.puml` y el PNG generado desde Mermaid.
