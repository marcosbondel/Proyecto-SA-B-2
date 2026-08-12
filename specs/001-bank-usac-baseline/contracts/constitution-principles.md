# Phase 1 — Contracts: los principios de la constitución

Lo que se escribirá en `.specify/memory/constitution.md` mediante `/speckit-constitution`. Cada principio se toma del enunciado, no de la paráfrasis del ticket, y lleva el criterio por el cual un plan futuro se declara conforme o no conforme.

**Son ocho.** El ticket parafraseaba seis y este documento llegó a listar siete: el despliegue en Kubernetes local se había perdido entre ambas versiones. Corregido el 2026-08-11 tras `/speckit-analyze`.

**Versión**: `1.0.0` · **Ratificada**: 2026-08-11 · **Última enmienda**: 2026-08-11

La prueba de que un principio está bien redactado: se puede construir una propuesta que lo viole y el veredicto es obvio para dos personas distintas sin discutirlo.

---

### I. Exactamente cinco microservicios

**Enunciado**: el sistema se compone de Customer, Account, Transaction, Payment y Notification & Audit. Ni uno más, ni uno menos, con responsabilidades claramente delimitadas.

**Fuente**: §4.2, p. 8.

**Conformidad**: un plan es **no conforme** si introduce un sexto servicio desplegable, si fusiona dos de los cinco, o si asigna a un servicio una responsabilidad que el enunciado atribuye a otro.

**Penalización declarada**: el enunciado penaliza mezclar responsabilidades entre servicios y los servicios "god object" ("Observaciones críticas", p. 7).

---

### II. Una base de datos por servicio, sin acceso cruzado

**Enunciado**: cada microservicio tiene su propia base de datos y no accede a la base de otro servicio.

**Fuente**: "Reglas de diseño obligatorias", p. 7.

**Conformidad**: **no conforme** si dos servicios comparten esquema o instancia, si un servicio consulta tablas de otro, o si aparece una consulta que une datos de dos dominios. Los datos de otro servicio se obtienen por evento, nunca por lectura directa.

---

### III. Bases de datos externas al cluster

**Enunciado**: las bases viven fuera del cluster de Kubernetes, como contenedores Docker o servicios locales.

**Fuente**: §4.2, p. 8; §4.3, p. 14.

**Conformidad**: **no conforme** si un manifiesto de Kubernetes despliega un motor de base de datos dentro del cluster.

---

### IV. Comunicación entre servicios exclusivamente asíncrona

**Enunciado**: modelo de comunicación completamente asíncrono. **No existen** llamadas HTTP entre servicios ni acoplamiento directo.

**Fuente**: §4.2, p. 8; "Reglas de diseño obligatorias", p. 7.

**Conformidad**: **no conforme** si un servicio expone o consume un endpoint HTTP de otro servicio, si importa código de otro servicio, o si una operación bloquea esperando la respuesta síncrona de otro. Request/reply está permitido solo en su forma asíncrona sobre el broker.

**Penalización declarada**: comunicación directa entre servicios y falta de eventos claros ("Observaciones críticas", p. 7).

---

### V. El API Gateway es el único punto de entrada y no tiene lógica de negocio

**Enunciado**: el Gateway es el punto de entrada al sistema.

**Fuente**: §4.2, p. 8. La ausencia de lógica de negocio es decisión registrada del equipo.

**Conformidad**: **no conforme** si un cliente externo alcanza un servicio sin pasar por el Gateway, o si el Gateway decide algo del dominio en lugar de enrutar, autenticar y agregar.

---

### VI. Saga obligatorio para operaciones distribuidas

**Enunciado**: Saga es obligatorio; la coreografía es el enfoque recomendado.

**Fuente**: "Patrones esperados", p. 7.

**Conformidad**: **no conforme** si una operación que toca dos o más servicios —la transferencia entre cuentas es el caso central— carece de pasos de compensación definidos, o si se resuelve con una transacción distribuida bloqueante.

---

### VII. Despliegue en un cluster local de Kubernetes

**Enunciado**: el sistema se despliega en un cluster local de Kubernetes, con contenedores Docker. La orquestación es obligatoria, no opcional.

**Fuente**: §4.2, p. 8; §4.3, p. 14.

**Conformidad**: **no conforme** si un plan propone ejecutar los servicios directamente en la máquina, con solo Docker Compose, o en un cluster remoto. La contraparte de este principio es el III: los servicios van dentro del cluster, las bases fuera.

---

### VIII. SRE desde el diseño

**Enunciado**: aplicación de principios de DevOps y SRE desde el diseño. Cada servicio debe considerar idempotencia, retries, manejo de errores, consistencia eventual y trazabilidad por `correlationId`.

**Fuente**: §4.2, p. 8; "Consideraciones SRE (obligatorias)", p. 7.

**Conformidad**: **no conforme** si un plan de servicio no dice cómo garantiza idempotencia, cómo reintenta, qué pasa cuando falla, y cómo propaga el `correlationId`. El enunciado además exige definir SLI, SLO y SLA (§4.2, §4.4), y diagramas C4 y UML como evidencia de comprensión.

---

## Gobernanza

- La constitución rige sobre cualquier plan, spec o tarea de este repositorio. Cuando un artefacto la contradice, gana la constitución.
- Los ocho principios provienen del enunciado y **no son enmendables por el equipo**: enmendarlos es incumplir el proyecto. Lo que sí puede cambiar es la redacción de un criterio de conformidad, si se demuestra ambiguo en la práctica.
- Toda enmienda registra versión, fecha y motivo. Versionado semántico: `MAJOR` si cambia o desaparece un principio, `MINOR` si se agrega uno, `PATCH` si solo se aclara una redacción.
- `/speckit-analyze` contrasta cada spec y cada plan contra estos principios. Un veredicto de no conformidad bloquea la implementación hasta que se corrija o se justifique en la tabla de complejidad del plan.
- `ARCHITECTURE.md` describe estas mismas restricciones para lectores humanos. Las dos materializaciones cambian en el mismo commit o divergen.
