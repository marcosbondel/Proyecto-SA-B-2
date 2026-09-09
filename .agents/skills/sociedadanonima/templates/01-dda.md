<!--
PLANTILLA · Documento de Decisión y Diseño de Arquitectura (DDA)
Fases F1, F2 y F9. Es el documento raíz: todo lo demás se cuelga de sus IDs.
Reemplaza <…>. Borra las secciones que el proyecto no necesite, pero borra la
sección entera con una línea que diga por qué — no la dejes vacía.
-->

# Documento de Decisión y Diseño de Arquitectura — <Proyecto>

> **Estado:** <borrador | aprobado> · **Fecha:** <YYYY-MM-DD> ·
> **Responsable:** <nombre>
> **Fuente del alcance:** <enunciado, contrato, brief — con su ubicación>

## 1. Caso del negocio

### 1.1 Contexto y visión

<Dos o tres párrafos: qué problema existe hoy, para quién, qué se construye y
qué cambia cuando exista. Sin tecnología todavía.>

### 1.2 No objetivos

Lo que este proyecto **no** hace, con el motivo:

| # | Fuera de alcance | Motivo |
| --- | --- | --- |
| NO-01 | <…> | <…> |

### 1.3 Actores de negocio

| Actor | Tipo | Alcance en el dominio |
| --- | --- | --- |
| <Nombre> | Humano / Sistema externo / Proceso automático | <qué hace y qué no> |

## 2. Stakeholders y preocupaciones

| ID | Stakeholder | Interés principal | Preocupación arquitectónica |
| --- | --- | --- | --- |
| STK-01 | <…> | <…> | <lo concreto que le quita el sueño> |

> Una preocupación como «que funcione bien» no es una preocupación. Si no sale
> algo específico, queda `[PENDIENTE: entrevistar a <stakeholder>]`.

## 3. Características priorizadas

**Criterio de corte:** <qué convierte algo en crítico frente a alto, escrito
antes de tener prisa>

### 3.1 Críticas

- **CAR-01 <Nombre>** — <por qué sin esto el sistema no sirve>

### 3.2 Altas

- **CAR-0n <Nombre>** — <…>

### 3.3 Medias

- **CAR-0n <Nombre>** — <…>

## 4. Requisitos funcionales

| ID | Módulo | Nombre | Descripción | Actor(es) | Prioridad |
| --- | --- | --- | --- | --- | --- |
| RF-01 | <CDU00n> | <…> | <qué hace exactamente> | <…> | Alta/Media/Baja |

### 4.1 Historias de usuario

| ID | RF | Historia | Criterios de aceptación |
| --- | --- | --- | --- |
| HU-01 | RF-01 | **Como** <rol>,<br/>**quiero** <acción>,<br/>**para** <valor>. | **Dado** <contexto>,<br/>**cuando** <acción>,<br/>**entonces** <resultado observable>. |

## 5. Requisitos no funcionales

| ID | Atributo | Métrica / umbral | Mecanismo de soporte |
| --- | --- | --- | --- |
| RNF-01 | <Disponibilidad / Rendimiento / Seguridad / …> | <número con unidad> | <qué de la arquitectura lo sostiene> |

> Sin número y unidad no entra. «Rápido» vuelve como `[PENDIENTE]`.

### 5.1 Escenarios de atributos de calidad

Un escenario por cada RNF que importe de verdad. Seis campos, ninguno opcional:

#### EAC-01: <Nombre> (<Crítico | Alto | Medio>)

- **Fuente del estímulo:** <quién o qué lo provoca>
- **Estímulo:** <qué llega al sistema>
- **Artefacto:** <qué parte del sistema responde>
- **Entorno:** <en qué condiciones — normal, degradado, pico>
- **Respuesta:** <qué hace el sistema>
- **Medida de respuesta:** <el número que decide si pasó o no>

## 6. Restricciones

| ID | Categoría | Restricción | Origen y consecuencia arquitectónica |
| --- | --- | --- | --- |
| RES-01 | Técnica / Normativa / Negocio / Operativa | <…> | <quién la impone y qué cierra> |

## 7. Matrices de trazabilidad

> Se completan en F9, cuando existen los demás documentos. Marca con `X`.

### 7.1 RF × Stakeholders

| RF | STK-01 | STK-02 | … |
| --- | :---: | :---: | :---: |
| RF-01 | X | | |

### 7.2 RF × RNF

| RF | RNF-01 | RNF-02 | … |
| --- | :---: | :---: | :---: |
| RF-01 | X | | |

### 7.3 CDU × EAC

| CDU | EAC-01 | EAC-02 | … |
| --- | :---: | :---: | :---: |
| CDU001 | X | | |

### 7.4 CDU × Actores (matriz de autorización)

| CDU | <Rol A> | <Rol B> | <Rol C> |
| --- | :---: | :---: | :---: |
| CDU001.1 <…> | Permitido | Denegado | Permitido |

### 7.5 HU × RF · 7.6 Tickets × RF

| HU | RF cubiertos |  | Ticket | RF / CDU que satisface |
| --- | --- | --- | --- | --- |
| HU-01 | RF-01, RF-02 |  | T-01 | RF-01 |

### 7.7 Informe de huecos

- **Requisitos sin ticket:** <lista o «ninguno»>
- **Tickets sin requisito:** <lista o «ninguno»>
- **RNF sin escenario:** <lista o «ninguno»>
- **Stakeholders sin RF asociado:** <lista o «ninguno»>

## 8. Supuestos y pendientes

| Marca | Dónde | Qué falta | Quién decide |
| --- | --- | --- | --- |
| `[SUPUESTO]` | <§> | <…> | <…> |
| `[PENDIENTE]` | <§> | <…> | <…> |
