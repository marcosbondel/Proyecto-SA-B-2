# Antipatrones

Cómo se ve un documento que no sirve. Revisa esta lista **antes** de cerrar cada
fase: la mayoría de estos defectos son invisibles desde dentro del documento y
obvios desde fuera.

Todos comparten una propiedad: el documento se ve terminado y no sostiene
ninguna decisión.

---

## Transversales

**El documento museo.** Escrito una vez, nunca actualizado, contradice al código
desde el segundo mes. *En su lugar:* actualiza el documento en el mismo cambio
que lo vuelve falso. Si no se puede, márcalo `[DIVERGENCIA]` y ponlo en el
backlog con ID.

**La certeza inventada.** Todo suena decidido porque quien escribió rellenó los
huecos con lo plausible. *En su lugar:* `[SUPUESTO: …]` y `[PENDIENTE: …]`
visibles, listados al cerrar la fase.

**El adjetivo con corbata.** «Robusto», «escalable», «seguro», «óptimo». No
significan nada y no se pueden verificar. *En su lugar:* un número, una unidad y
un mecanismo que lo sostiene.

**La renumeración.** Alguien ordena alfabéticamente y `RF-07` pasa a ser
`RF-04`. Cada referencia cruzada del repositorio queda mintiendo a la vez, en
silencio. *En su lugar:* los IDs se congelan al nacer; lo muerto se marca
`OBSOLETO` y conserva su fila.

**El documento que no cita a nadie.** No referencia ningún otro artefacto, y
nadie lo referencia. Es un texto huérfano: no se actualiza porque nada lo obliga.
*En su lugar:* todo nodo apunta hacia arriba (qué lo motiva) y hacia abajo (qué
lo realiza).

---

## Caso de negocio y requisitos

**El stakeholder decorativo.** Aparece en la tabla con la preocupación «que el
sistema funcione correctamente». No aporta nada y ocupa una fila. *En su lugar:*
la preocupación específica que le quita el sueño, o fuera de la tabla.

**El alcance sin fronteras.** Solo dice qué se hará. *En su lugar:* la lista de
**no objetivos** explícita. Es la que evita la conversación de la semana diez.

**El requisito que es una solución.** «El sistema usará Redis para cachear». Eso
es una decisión de F4 disfrazada de requisito, y cierra el diseño antes de
abrirlo. *En su lugar:* el requisito es la necesidad («la consulta responde en
menos de X con Y usuarios»); la tecnología es un ADR con alternativas.

**El criterio de aceptación no verificable.** «El usuario tiene una buena
experiencia». *En su lugar:* dado/cuando/entonces con un resultado observable
que alguien pueda comprobar sin interpretar.

---

## Dominio

**El glosario que define lo obvio y calla lo ambiguo.** Define «usuario» y no
define el término del negocio que dos personas del equipo entienden distinto.
*En su lugar:* empieza por las palabras que causan discusión.

**Los estados sin transiciones.** Se listan los estados y no qué transición es
legal. Entonces cualquier código es correcto. *En su lugar:* el diagrama, y la
frase «toda transición no dibujada es ilegal y se descarta».

**La invariante sin fallo.** «El saldo nunca es negativo». ¿Y qué pasa cuando
alguien lo intenta? ¿Se rechaza, se trunca, se registra? *En su lugar:* cada
invariante lleva el nombre del rechazo.

**La matriz de permisos que solo dice sí.** Enumera lo permitido y calla lo
prohibido. Lo prohibido es lo que se implementa mal. *En su lugar:* una sección
de fronteras por rol: qué **no** puede hacer y cómo se llama el rechazo.

**El caso de uso sin fallos.** Solo el camino feliz. El camino feliz es la parte
que sale sola. *En su lugar:* tabla de fallos **esperados** —los que el diseño
contempla— separada de los accidentes.

---

## Arquitectura

**El ADR sin alternativa descartada.** Si no había alternativa, no hubo decisión:
es una nota, no un ADR. *En su lugar:* al menos una opción real con el motivo
del descarte. «No lo consideramos» también es un motivo, y honesto.

**La justificación por popularidad.** «Es el estándar de la industria», «es lo
que se usa hoy». Ninguna de las dos es un driver de este proyecto. *En su lugar:*
el ID del requisito o del escenario de calidad que lo exige.

**La consecuencia negativa vacía.** «Ninguna» o «mayor curva de aprendizaje»
puesto por compromiso. Toda decisión duele en algo. *En su lugar:* qué se pierde
de verdad, y qué habría que hacer si algún día duele demasiado.

**El diagrama binario.** Una imagen exportada de una herramienta propietaria, sin
fuente. No se puede revisar en un cambio ni actualizar sin la licencia. *En su
lugar:* fuente en texto versionada junto al documento; la imagen es un producto,
no el original.

**La arquitectura sin driver.** Cinco componentes desplegables porque sí. *En su
lugar:* cada frontera existe por un requisito nombrado, o se elimina.

---

## Datos y contratos

**El tipo de dato por descuido.** Dinero en coma flotante, fecha sin zona
horaria, identidad en un entero autoincremental que se expone. Los tres se pagan
tarde y caro. *En su lugar:* decisión escrita por cada tipo sensible.

**La invariante que solo vive en el código.** El motor no la conoce, así que dos
escrituras concurrentes la rompen. *En su lugar:* cada invariante apunta a dónde
se hace cumplir, o se declara explícitamente que no se hace cumplir.

**El contrato sin versión.** Se cambia y rompe a un consumidor que nadie
recordaba. *En su lugar:* versión en el contrato y una regla escrita de qué es
cambio compatible.

---

## Fiabilidad

Ver [FIABILIDAD.md](FIABILIDAD.md). Los tres capitales: SLA con umbrales propios
que no coinciden con ningún SLO, SLO sin ventana de medición, y SLI sin fuente
de datos que exista.

---

## Plan y cronograma

**El ticket sin evidencia.** «Implementar el módulo». ¿Cómo se sabe que está?
*En su lugar:* el comando o la prueba que lo demuestra, escrita antes de
empezar.

**La estimación puntual sobre lo desconocido.** «3 días» para algo que nadie ha
hecho nunca. *En su lugar:* rango, o un spike acotado cuyo resultado es la
estimación.

**El cronograma sin ruta crítica.** Una lista de fechas ordenada. No permite
decidir nada cuando algo se retrasa. *En su lugar:* grafo de dependencias, ruta
crítica marcada y holgura por ticket.

**El colchón repartido.** Cada tarea inflada un 20 %. El margen se vuelve
invisible y se consume entero sin que nadie lo note. *En su lugar:* un bloque de
colchón al final, nombrado, que se gasta anotando por qué.

**La ruta crítica que empieza por la interfaz.** Se planifica lo que se ve, y lo
que puede invalidar el diseño queda para el final. *En su lugar:* primero lo que
puede demostrar que el diseño está mal; si hace falta enseñar algo temprano, una
demo delgada de extremo a extremo.

**El plan que se defiende.** Se sostiene la fecha original contra la evidencia
hasta la última semana. *En su lugar:* reestimar con el factor de desviación real
en cada hito, y aplicar el recorte que se decidió por escrito antes de tener
prisa.
