# Banco de preguntas por fase

Preguntas que hacen avanzar el proyecto. No es un cuestionario que se recita
entero: se eligen **las que cambian el resultado** de esta fase, máximo cinco,
y se hacen de una en una cuando la respuesta condiciona la siguiente.

Antes de preguntar algo, comprueba si ya está contestado en el material que
existe. Preguntar lo que está escrito en el enunciado quema la paciencia del
usuario y el presupuesto de preguntas.

---

## F0 — Encuadre

**Obligatorias**
1. ¿Es un proyecto nuevo o un sistema existente que hay que documentar?
2. ¿Cuál es la restricción dura: fecha, presupuesto, alcance o tecnología
   impuesta? (Casi siempre hay una y manda sobre las demás.)
3. ¿Quién decide cuando hay desacuerdo? ¿Quién recibe y evalúa el resultado?
4. ¿Cuántas personas, con qué dedicación real por semana?
5. ¿Dónde viven los documentos, en qué idioma, y hay convención previa?

**Si aplica**
- ¿Hay un enunciado, contrato o rúbrica que califique esto? Pídelo entero: es la
  única fuente que no se negocia.
- ¿Qué partes están ya decididas por alguien de fuera y no se pueden tocar?
- ¿Qué fases del flujo sobran para este proyecto? (Un prototipo interno rara vez
  necesita SLA; un sistema de terceros siempre.)

---

## F1 — Caso de negocio

1. En una frase: ¿qué problema resuelve y para quién?
2. ¿Qué pasa **si no se construye**? (Si la respuesta es «nada», el proyecto no
   tiene caso de negocio y conviene decirlo ahora.)
3. ¿Quién más se ve afectado aunque no lo use? Operaciones, cumplimiento,
   soporte, finanzas, seguridad.
4. Por cada interesado: ¿qué es lo que **más le preocupa** que salga mal?
5. ¿Qué está explícitamente **fuera** de alcance?
6. ¿Cómo sabremos dentro de tres meses que valió la pena?

**Presiona cuando** la preocupación sea un adjetivo. «Que sea rápido» → ¿rápido
en qué operación, medido por quién, comparado con qué?

---

## F2 — Requisitos

**Funcionales**
1. Recorre el sistema como lo recorre un usuario: ¿qué hace primero, después,
   cuando se equivoca, cuando abandona a la mitad?
2. ¿Qué operaciones hace el sistema **solo**, sin que nadie las pida? Trabajos
   programados, reintentos, limpiezas, avisos.
3. ¿Qué operación, si falla, hace inútil todo lo demás?

**No funcionales** — pregunta por umbral, no por atributo:
4. ¿Cuántos usuarios simultáneos en el peor momento previsible?
5. ¿Cuánto puede tardar la operación más lenta antes de que alguien se queje?
6. ¿Cuánto puede estar caído sin consecuencias? ¿Y cuál es la consecuencia?
7. ¿Qué dato, si se filtra, causa un daño real? ¿Y si se pierde? ¿Y si se
   duplica? (Las tres respuestas suelen ser datos distintos.)
8. ¿Qué obligación legal o normativa aplica y quién la verifica?

**Restricciones**
9. ¿Qué tecnología, proveedor o formato viene impuesto y por quién?
10. ¿Qué no se puede hacer aunque técnicamente se pueda?

**Presiona cuando** el umbral no tenga unidad. Todo RNF acaba en un número con
unidad o vuelve como `[PENDIENTE]`.

---

## F3 — Dominio

**Glosario**
1. ¿Qué palabras usa el negocio que no significan lo que parecen?
2. ¿Hay dos palabras para la misma cosa, o una palabra para dos cosas? (Es lo
   más común y lo que más caro sale.)

**Actores**
3. ¿Quién actúa sobre el sistema? Incluye sistemas externos y procesos
   automáticos: también son actores.
4. Por cada rol: ¿qué **no** puede hacer, y cómo se llama el rechazo cuando lo
   intenta?
5. ¿Hay operaciones que un rol superior tiene **más restringidas** que uno
   inferior? (Las hay más veces de las que parece, y son las que se implementan
   mal.)

**Entidades**
6. ¿Qué cosas siguen existiendo cuando se apaga el sistema?
7. Por cada una: ¿qué la identifica de forma única y para siempre?
8. ¿Qué estados admite? ¿El conjunto está cerrado? ¿Qué transición **no** es
   legal aunque parezca posible?
9. ¿Qué pasa si llega dos veces el mismo mensaje o petición? ¿Y si llegan
   desordenados?
10. ¿Qué regla no puede violarse nunca, y cómo se llama el fallo?

**Casos de uso**
11. Por cada uno: actor, precondición, entrada, **resultado observable**.
12. ¿Qué fallos son *esperados* —contemplados por el diseño— frente a
    accidentes? Solo los primeros van en la tabla.
13. ¿Qué operación cruza más de un componente? Esa necesita compensación
    definida, y es donde se pierden los datos.

---

## F4 — Arquitectura

1. ¿Qué driver de F2 exige realmente esta arquitectura? Si ninguno, la
   arquitectura sobra.
2. ¿Qué se despliega por separado y por qué debe poder desplegarse por separado?
3. ¿Qué componente puede caer sin llevarse al resto? ¿Cómo se garantiza?
4. ¿Cómo se comunican: síncrono, asíncrono, ambos? ¿Qué pasa cuando el otro lado
   no contesta?
5. ¿Quién es dueño de cada dato? ¿Quién más lo necesita y cómo lo obtiene sin
   ser dueño?
6. ¿Dónde vive el estado? ¿Qué pasa si hay dos instancias del mismo proceso?
7. Por cada decisión: ¿qué alternativas reales había y por qué se descartaron?
8. ¿Qué duele de la opción elegida? (Si no duele nada, no se analizó.)

**Presiona cuando** la justificación sea «es el estándar» o «es lo que se usa
hoy». Ninguna de las dos es un driver.

---

## F5 — Datos y contratos

1. ¿Qué tipo exige cada invariante? Dinero, tiempo, identidad y cantidades son
   los cuatro que se eligen mal.
2. ¿Qué garantiza el motor de almacenamiento y qué queda en el código? Toda
   invariante que dependa solo del código se rompe bajo concurrencia.
3. ¿Qué pasa si dos escrituras llegan a la vez al mismo registro?
4. ¿Qué se borra de verdad y qué solo se marca? ¿Cuánto se conserva?
5. ¿Qué campo es sensible y por tanto no debe viajar, registrarse ni auditarse
   en claro?
6. Por cada contrato de interfaz: ¿quién lo publica, quién lo consume, y qué
   pasa cuando cambia? ¿Está versionado?

---

## F6 — Fiabilidad

1. De todo lo que se puede medir, ¿qué **le importa al usuario**? Eso es el SLI;
   lo demás es telemetría.
2. ¿La fuente de datos de esa fórmula ya existe? Si no, el SLI es una tarea de
   instrumentación antes que un indicador.
3. ¿En qué ventana se mide? Un ratio sin período no significa nada.
4. ¿Cuánto incumplimiento se tolera antes de parar y arreglar?
5. ¿Qué objetivo **no admite ninguna tolerancia**? Corrección de dinero,
   privacidad, autorización.
6. ¿Qué se promete hacia afuera, y qué queda excluido de forma explícita?
7. ¿Qué **no** cuenta como incumplimiento? Los rechazos correctos del negocio
   son la exclusión que siempre se olvida.

---

## F7 — Plan

1. ¿Qué hay que construir primero porque todo lo demás depende de ello?
2. ¿Qué ticket puede **invalidar el diseño** si sale mal? Ese va antes que
   cualquier pantalla.
3. Por cada ticket: ¿qué comando o prueba demuestra que está hecho?
4. ¿Qué se puede hacer en paralelo de verdad, sin que dos personas toquen lo
   mismo?
5. ¿Qué es alcance mínimo y qué es deseable? El corte se escribe antes de tener
   prisa, no después.

---

## F8 — Cronograma

1. ¿Cuántas horas reales por persona y semana, descontando clases, reuniones,
   trabajo y vida?
2. ¿Hay fechas externas inamovibles? Entregas, evaluaciones, vacaciones.
3. ¿Qué depende de un tercero que no controlamos?
4. ¿Cuál es el riesgo que más probablemente rompa el plan, y qué se hace si
   ocurre?
5. Si la fecha no alcanza, ¿qué se recorta? Decidirlo ahora vale diez veces más
   que decidirlo la última semana.
