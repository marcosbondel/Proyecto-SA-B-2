<!--
PLANTILLA · Vista de arquitectura — Fase F4
Los diagramas se escriben en texto versionable junto a este documento. Una
imagen sin fuente no se puede revisar ni actualizar.
-->

# Arquitectura — <Proyecto>

## 1. Drivers que la determinan

Esta arquitectura existe por estos requisitos, no por gusto. Si un driver
desaparece, la pieza que lo atendía se revisa.

| Driver | Consecuencia arquitectónica |
| --- | --- |
| RNF-01 / EAC-01 | <qué obliga a hacer> |

## 2. Contexto

<Qué hay dentro del sistema, qué queda fuera, quién habla con quién.>

```
<diagrama en texto: fuente versionada en <ruta>>
```

## 3. Contenedores

| Componente | Responsabilidad | Tecnología | Almacén propio |
| --- | --- | --- | --- |
| <…> | <una frase; si necesita dos, probablemente son dos componentes> | <…> | <sí/no> |

## 4. Comunicación

| Origen | Destino | Mecanismo | Síncrono | Qué pasa si el otro lado no responde |
| --- | --- | --- | :---: | --- |
| <…> | <…> | <…> | sí/no | <…> |

## 5. Fronteras

Reglas que el diseño no permite cruzar, y **cómo se detecta** que alguien las
cruzó. Una frontera sin comprobación es una recomendación.

| # | Regla | Cómo se verifica |
| --- | --- | --- |
| F-01 | <…> | <regla de análisis estático, prueba, revisión> |

## 6. Estado y escalado

- **Dónde vive el estado:** <…>
- **Qué se puede replicar y qué no:** <componente que no admite dos instancias y
  por qué — trabajos programados sin elección de líder, colas exclusivas, etc.>
- **Qué se rompe si alguien lo replica igualmente:** <…>

## 7. Despliegue

| Entorno | Cómo se levanta | Qué queda fuera |
| --- | --- | --- |
| Local | <…> | <…> |
| <Producción / evaluación> | <…> | <…> |

## 8. Decisiones

Las decisiones que sostienen esta vista están en [ADR](adr.md): <ADR-001,
ADR-002, …>. Este documento describe **qué es**; el ADR explica **por qué**.
