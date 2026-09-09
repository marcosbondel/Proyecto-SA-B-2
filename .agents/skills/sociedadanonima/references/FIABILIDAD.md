# SLI, SLO y SLA

Tres documentos, tres cosas distintas, y la confusión entre ellos es el error
más frecuente de F6.

| Documento | Qué es | Frase que lo define |
| --- | --- | --- |
| **SLI** | El indicador | «Esto es lo que medimos, con esta fórmula y esta fuente» |
| **SLO** | El objetivo | «Esta es la meta interna, en esta ventana, con este margen» |
| **SLA** | El acuerdo | «Esto es lo que prometemos a alguien de fuera, y esto excluimos» |

**Regla de encadenamiento: el SLA no introduce umbrales propios.** Cada promesa
apunta al SLO que la respalda, y cada SLO al SLI que lo prueba. Una promesa sin
objetivo detrás es una declaración de intenciones; un objetivo sin indicador es
un deseo con decimales.

---

## SLI — el indicador

Cada SLI necesita exactamente tres cosas:

1. **Nombre** de lo que le importa al usuario.
2. **Fórmula** que produce un número — normalmente `eventos buenos / eventos
   totales`, o un percentil de una duración.
3. **Fuente de datos que ya existe** en el sistema.

Si la fuente no existe, el SLI todavía no es un indicador: es una tarea de
instrumentación, y va al backlog de F7 antes de aparecer aquí.

**Mide lo que sufre el usuario, no lo que es fácil de contar.** El uso de CPU no
es un SLI: nadie ha reclamado nunca por un porcentaje de CPU. La latencia de la
operación que espera mirando la pantalla, sí.

**Separa fallo técnico de rechazo de negocio.** «Fondos insuficientes» o «no
autorizado» son respuestas **correctas**: contarlas como indisponibilidad mide
la solvencia o los permisos de los usuarios en lugar de la salud del servicio.
Escríbelo explícitamente en el documento; es la aclaración que evita la discusión
de después.

**Indicadores cuyo valor correcto es cero** —datos sensibles en claro, saldos
negativos, secretos en una imagen— se reportan como **recuento absoluto, nunca
como porcentaje**. Un 99.99 % invita a negociar; un recuento distinto de cero es
un defecto y se ve como tal.

### Familias que suelen hacer falta

- **Borde:** disponibilidad, latencia por percentil, distribución de errores por
  clase, expiraciones.
- **Plataforma:** réplicas listas, tiempo hasta listo, reinicios.
- **Integración:** pérdida de mensajes, reintentos, mensajes no interpretables,
  latencia de propagación.
- **Dominio:** integridad de los datos que importan, transiciones ilegales
  rechazadas, efectividad de la idempotencia.
- **Seguridad:** corrección del control de acceso, ausencia de secretos, higiene
  de sesión.

---

## SLO — el objetivo

Cada SLO necesita: **umbral**, **ventana de medición**, **presupuesto de error**
e **indicador base**.

**Un objetivo sin ventana es indemostrable.** Todo umbral es un ratio, y un ratio
sin período no significa nada: «¿99 % de qué, desde cuándo?».

### Dos clases de objetivo

**Con presupuesto de error.** Calidad de servicio: latencia, disponibilidad,
puntualidad. Admiten degradación acotada. El presupuesto es la fracción que se
puede incumplir sin declarar el objetivo roto, y **se contabiliza por ventana,
sin arrastrar** lo sobrante a la siguiente.

**Sin presupuesto de error.** Corrección, dinero, privacidad, autorización. Una
sola infracción invalida el objetivo. Un presupuesto de error es un permiso para
fallar una fracción del tiempo, y hay cosas donde ninguna fracción es aceptable:
un sistema que duplica un cobro una de cada mil veces sigue siendo un sistema que
duplica cobros.

Clasificar cada objetivo en una de las dos clases **es** el trabajo de F6.
Ponerlo todo en la primera clase es cobardía; ponerlo todo en la segunda hace el
documento inservible en cuanto algo tarde 20 ms de más.

### Velocidad de consumo

Para los objetivos con presupuesto, el ritmo importa tanto como el total:

```
velocidad de consumo = (fracción de presupuesto gastada) / (fracción de ventana transcurrida)
```

Por encima de 1 sostenido, el objetivo se incumplirá antes de que termine la
ventana aunque el porcentaje instantáneo todavía se vea sano. Es la diferencia
entre un 99.4 % estable y un 99.4 % en caída libre, que sin esto se ven idénticos.

---

## SLA — el acuerdo

Cuatro partes, y ninguna sobra:

1. **Alcance y ventana.** Qué se promete y **cuándo aplica**. Fuera de la
   ventana no se mide ni se promete nada, y decirlo protege a ambas partes.
2. **Compromisos por componente**, cada uno apuntando a los SLO que lo respaldan.
3. **Exclusiones.** Qué no cuenta como incumplimiento. Como mínimo: rechazos
   correctos del negocio, fallos del entorno del consumidor, y degradación
   inducida deliberadamente durante una prueba. **Sin exclusiones escritas, todo
   fallo ajeno es tuyo.**
4. **Régimen de remedios.** Qué ocurre cuando se incumple. En un contrato
   comercial son créditos; en un contexto académico o interno es procedimental:
   declararlo, documentar la causa raíz, reejecutar y generar evidencia nueva —
   no reinterpretar la anterior.

Añade **severidades** cuando el acuerdo cubra operación: qué es crítico, qué es
degradación, y qué tiempo de respuesta y de mitigación tiene cada nivel.

---

## Errores que esta sección existe para evitar

- **Un SLA con umbrales propios** que no coinciden con ningún SLO. Dos verdades
  distintas sobre el mismo sistema, y la que se cita en la reunión es siempre la
  peor para ti.
- **Un SLO sin ventana.** Indemostrable, y por tanto incumplible e incumplido a
  la vez.
- **Un SLI sin fuente.** Se descubre el día que alguien pide el número.
- **Presupuesto de error sobre una invariante de corrección.** Convierte un
  defecto en una cuota.
- **Contar rechazos de negocio como indisponibilidad.** Los números empeoran
  cuando el sistema hace exactamente lo que debe.
- **Copiar el 99.9 % de otro sistema.** Ese número tiene un coste de
  arquitectura; si no puedes nombrar qué mecanismo lo sostiene, no lo prometas.
