# Manuales de Bank USAC

> El manual de usuario de Bank USAC se encuentra **completamente unificado en un solo documento canónico**:
> 👉 **[Manual de Usuario Unificado — Bank USAC](../manual-usuario.md)**

Esta unificación consolida todas las guías de rol, las especificaciones de negocio, el recorrido visual con capturas reales de producción de Fase III y el recorrido visual práctico de 78 pasos en una sola fuente de verdad para evitar duplicidad y discrepancias.

### Acceso Directo por Sección en el Manual Unificado

| Sección | Descripción y Alcance | Enlace Directo |
| --- | --- | --- |
| **1. Antes de Empezar y Accesos** | Puntos de acceso cloud/local, credenciales de demo, reglas de seguridad y matriz de roles. | [Ver §1](../manual-usuario.md#1-antes-de-empezar-y-accesos) |
| **2. Fundamentos del Sistema** | Códigos HTTP 202 vs 200, correlación (`correlationId`), trazas (`traceId`), idempotencia y montos. | [Ver §2](../manual-usuario.md#2-fundamentos-y-lectura-de-respuestas) |
| **3.1 Portal del Cliente** | Registro público, activación, cuentas monetarias/ahorro, transferencias Saga, interbancario, pagos y avisos. | [Ver §3.1](../manual-usuario.md#31-portal-del-cliente-cliente) |
| **3.2 Portal del Cajero Receptor** | Ventanilla presencial, registro con validación física, mesa de control de DPI, aperturas y depósitos. | [Ver §3.2](../manual-usuario.md#32-portal-del-cajero-receptor-cajero_receptor) |
| **3.3 Portal del Administrador** | Alta de personal, auditoría transversal (4 filtros AND), payloads redactados, consola de notificaciones y simulación. | [Ver §3.3](../manual-usuario.md#33-portal-del-administrador-administrador) |
| **3.4 Observabilidad (Operador / SRE)** | Dashboards en Grafana, trazas en Tempo (TraceQL), logs en Loki (LogQL) y métricas en Prometheus. | [Ver §3.4](../manual-usuario.md#34-plataforma-de-observabilidad--operador--sre) |
| **4. Recorrido Visual de Fase III** | 12 capturas reales de producción en Google Cloud (interbancario, auditoría, pagos, ventanilla, Tempo). | [Ver §4](../manual-usuario.md#4-recorrido-visual-de-fase-iii-evidencia-real-en-producción) / [Guía dedicada](recorrido-fase3.md) |
| **5. Recorrido Visual Práctico (78 Pasos)** | Flujo continuo paso a paso sobre el caso de negocio unificado con capturas integradas. | [Ver §5](../manual-usuario.md#5-recorrido-visual-paso-a-paso-del-flujo-práctico-integral) |
| **6. Contingencias y Soporte** | Reporte de anomalías, procedimiento ante estados inciertos (TIMEOUT) y protocolo de escalamiento. | [Ver §6](../manual-usuario.md#6-manejo-de-errores-contingencias-y-soporte-técnico) |

---
*Para la guía técnica de arquitectura, despliegue y desarrollo, consulta el [Manual Técnico](../manual-tecnico.md).*
