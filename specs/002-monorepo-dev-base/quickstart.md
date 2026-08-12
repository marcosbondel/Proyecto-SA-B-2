# Quickstart — Verificación ejecutable: Monorepo y base de desarrollo (T-04)

Un comando o comprobación concreta por criterio de éxito del [spec.md](spec.md). Todo se corre desde la raíz del repositorio salvo indicación contraria.

**Prerequisitos**: Node 24.19.0 (`node -v`), pnpm 11.21.0 (`pnpm -v`), checkout limpio de la rama `feature/T-04`.

---

## SC-001 y SC-002 — Checkout limpio instala, compila, linta y prueba

```bash
git clone <repo> /tmp/bank-usac-verify && cd /tmp/bank-usac-verify
git switch feature/T-04
time pnpm install && time pnpm build && pnpm lint && pnpm test
```

**Esperado**: los cuatro comandos en verde; tiempo total < 15 minutos. La salida real se adjunta al ticket como evidencia.

```bash
# Cada una de las 7 aplicaciones tiene build y prueba propios:
for app in gateway web customer-service account-service transaction-service payment-service notification-audit-service; do
  pnpm --filter $app build && pnpm --filter $app test || echo "FALLA: $app"
done
```

**Esperado**: siete builds y siete pruebas mínimas en verde, sin línea `FALLA`.

---

## SC-003 — El aislamiento de dominio es ejecutable

```bash
# 1. Intento de importar dominio de otro servicio (debe fallar):
mkdir -p /tmp/bank-usac-verify/services/account-service/src/application
cat > services/account-service/src/application/escape-hatch.ts <<'EOF'
import { CustomerEntity } from '../../../customer-service/src/domain/customer.entity';
export const leak = CustomerEntity;
EOF
pnpm --filter account-service lint
# Esperado: error de no-restricted-imports. Borrar el archivo después:
rm services/account-service/src/application/escape-hatch.ts

# 2. Ninguna dependencia apunta contra el dominio:
grep -rn "from '.*infrastructure" services/*/src/domain services/*/src/application
# Esperado: sin salida.
```

---

## SC-004 — Contratos compartidos sin acoplar dominio

```bash
pnpm --filter @bank/contracts build && pnpm test:contract
```

**Esperado**: el paquete compila y la prueba de contrato de ejemplo pasa. La evidencia incluye el ejemplo de importación desde `apps/gateway` y desde un servicio, sin importar dominio ajeno (ver [contracts/workspace-contracts.md §2](contracts/workspace-contracts.md)).

```bash
# El paquete no contiene lógica de negocio:
grep -rniE "entity|repository|use-?case" packages/contracts/src --include="*.ts" -l
# Esperado: sin salida (los eventos de dominio llegan con T-05).
```

---

## SC-005 — Lint y pruebas, global y por aplicación

```bash
pnpm lint && pnpm test                    # global
pnpm --filter transaction-service lint    # por aplicación
pnpm --filter transaction-service test
```

**Esperado**: ambos niveles en verde; salida adjunta como evidencia.

---

## SC-006 — Cero pendientes sin marcar

```bash
grep -rn "Blocked" infra/ docs/architecture/ docs/events/ docs/operations/ packages/contracts/src/ | grep -cv "Owner:.*Arrives with: T-"
```

**Esperado**: `0` — toda marca de bloqueo tiene responsable y ticket destino.

```bash
grep -c "T-04" docs/TECH_DEBT.md
```

**Esperado**: ≥ 1 — los pendientes detectados están registrados.

---

## SC-007 — La web existente sigue funcionando

```bash
pnpm --filter web build
```

**Esperado**: build de Nuxt en verde, igual que antes de la integración. Salida adjunta al ticket.

---

## SC-008 — T-05/T-06/T-07 arrancan sin preguntar

Comprobación manual sobre el árbol resultante:

1. ¿`packages/contracts/` compila y tiene dónde poner los eventos? → T-05 desbloqueado.
2. ¿`infra/docker/` existe con su marca de bloqueo y las versiones fijadas (PostgreSQL 18.4, RabbitMQ 4.3.4)? → T-06 desbloqueado.
3. ¿`docs/architecture/`, `docs/events/`, `docs/operations/` existen con marca de bloqueo? → T-07 desbloqueado.

---

## FR-013 — Validación de variables al arrancar

```bash
cd services/customer-service && cp .env.example .env
# Borrar DATABASE_URL del .env, luego:
pnpm dev
```

**Esperado**: el proceso falla de inmediato con un mensaje que nombra `DATABASE_URL`; código de salida distinto de cero.

---

## Versiones fijadas (evidencia de soporte y vulnerabilidades)

La tabla completa está en [research.md](../research.md) (R1–R8). Verificación rápida de lo instalado:

```bash
node -v          # v24.19.0
pnpm -v          # 11.21.0
pnpm audit       # Esperado: 0 vulnerabilidades
```
