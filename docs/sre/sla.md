# Acuerdos de Nivel de Servicio (SLA) — Bank USAC

Este documento formaliza el **Acuerdo de Nivel de Servicio (Service Level Agreement)** aplicable para el entorno del proyecto Bank USAC.

---

## 1. Alcance y Compromiso de Servicio

* **Ámbito de Aplicación**: Demostración y evaluación académica del sistema bancario local y orquestación con Kubernetes/Docker.
* **Compromiso Principal**:
  1. Levantar la infraestructura completa de contenedores de forma reproducible y sana (`pnpm dev:infra` y `pnpm dev:host`).
  2. Ejecutar el flujo de negocio bancario integral: registro, activación, apertura de cuentas y transferencias interbancarias.
  3. Demostrar visual y contablemente la ejecución exitosa de la **Saga en sus tres variantes**:
     * Camino exitoso (`COMPLETED`).
     * Fallo inmediato y reversa contable (`COMPENSATED`).
     * Escalera de reintentos agotada con reversa contable (`COMPENSATED`).
  4. Garantizar la trazabilidad de extremo a extremo mediante el identificador `correlationId`.

---

## 2. Condiciones y Responsabilidades

* **Naturaleza Académica**: El presente SLA delimita el comportamiento funcional durante la ventana de evaluación y pruebas automatizadas (`pnpm images:smoke` y `pnpm images:flow`).
* **Verificación de Cumplimiento**: Evidenciado mediante la suite de validación de QA documentada en [`docs/qa-validation-report.md`](../qa-validation-report.md) y los logs estructurados con niveles `INFO`, `WARN` y `ERROR`.
