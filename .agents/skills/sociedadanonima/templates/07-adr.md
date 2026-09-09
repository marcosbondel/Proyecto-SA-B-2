<!--
PLANTILLA · Registro de decisiones — Fase F4
Regla dura: ningún ADR sin alternativa descartada. Si no había alternativa no
hubo decisión, y eso es una nota en el documento de arquitectura, no un ADR.
-->

# Registro de decisiones de arquitectura — <Proyecto>

Cada registro documenta el **contexto** que forzó la decisión, la **solución
adoptada**, las **alternativas descartadas** con su motivo, la **justificación
atada a un driver por ID** y las **consecuencias** en ambos signos.

## Matriz resumen

| Código | Título | Solución adoptada | Alternativa principal descartada | Driver |
| --- | --- | --- | --- | --- |
| ADR-001 | <…> | <…> | <…> | RNF-nn / EAC-nn |

---

## ADR-001: <Título>

- **Estado:** <propuesta | aceptada | reemplazada por ADR-nnn> ·
  **Fecha:** <YYYY-MM-DD>
- **Contexto:** <qué problema forzó la decisión; qué se sabía y qué no>
- **Decisión:** <lo que se hace, en presente y sin condicionales>
- **Alternativas descartadas:**
  - *<Opción B>:* descartada porque <motivo concreto — no «es peor»>.
  - *<Opción C>:* descartada porque <…>.
- **Justificación:**
  - **Atiende a <RNF-nn> / <EAC-nn>:** <cómo, exactamente>.
- **Consecuencias:**
  - *Positivo:* <qué gana el sistema>.
  - *Negativo:* <qué se pierde, y qué habría que hacer si algún día duele
    demasiado>. **Nunca «ninguna»** — toda decisión cuesta algo.
- **Cómo se revisa:** <qué tendría que cambiar en el proyecto para reabrir esta
  decisión>.

---

# Decisiones de dominio

Decisiones sobre **el negocio**, no sobre la tecnología. Se numeran aparte
porque se revisan por motivos distintos: un ADR se reabre cuando cambia la
tecnología; una `D-` cuando cambia el negocio.

## D-01: <Título>

- **Decisión:** <…>
- **Justificación:** <…>
- **Consecuencia visible:** <qué se comporta distinto por esto, y dónde se nota>
