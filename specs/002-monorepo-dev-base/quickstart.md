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
cat > apps/services/account-service/src/application/escape-hatch.ts <<'EOF'
import { CustomerEntity } from '../../../customer-service/src/domain/customer.entity';
export const leak = CustomerEntity;
EOF
pnpm --filter account-service lint
# Esperado: error de no-restricted-imports. Borrar el archivo después:
rm apps/services/account-service/src/application/escape-hatch.ts

# 2. Ninguna dependencia apunta contra el dominio:
grep -rn "from '.*infrastructure" apps/services/*/src/domain apps/services/*/src/application
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
grep -rniE "entity|repository|use-?case" apps/packages/contracts/src --include="*.ts" -l
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
grep -rn "Blocked" infra/ docs/architecture/ docs/events/ docs/operations/ apps/packages/contracts/src/ | grep -cv "Owner:.*Arrives with: T-"
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

1. ¿`apps/packages/contracts/` compila y tiene dónde poner los eventos? → T-05 desbloqueado.
2. ¿`infra/docker/` existe con su marca de bloqueo y las versiones fijadas (PostgreSQL 18.4, RabbitMQ 4.3.4)? → T-06 desbloqueado.
3. ¿`docs/architecture/`, `docs/events/`, `docs/operations/` existen con marca de bloqueo? → T-07 desbloqueado.

---

## FR-013 — Validación de variables al arrancar

```bash
pnpm build                                   # las apps se ejecutan desde dist/
cd apps/services/customer-service
grep -v '^DATABASE_URL' .env.example > .env  # copia sin la variable obligatoria
pnpm start; echo "EXIT CODE: $?"
```

**Esperado**: el proceso falla de inmediato con un mensaje que nombra `DATABASE_URL` y sale con código distinto de cero:

```text
Invalid environment for "customer-service". Offending variables: DATABASE_URL
  - DATABASE_URL: DATABASE_URL should not be empty; DATABASE_URL must be a string
EXIT CODE: 1
```

Se usa `pnpm start` y no `pnpm dev` porque `nest start --watch` se queda observando archivos tras el fallo y no propaga el código de salida; el criterio pide un código distinto de cero, y eso solo lo demuestra el binario construido. Borrar el `.env` al terminar.

Con el `.env` completo el servicio arranca en modo health-check, sin broker ni base:

```bash
cp .env.example .env && node dist/main.js &
curl -s http://localhost:3001/health   # {"status":"ok","application":"customer-service"}
```

---

## Versiones fijadas (evidencia de soporte y vulnerabilidades)

La tabla completa está en [research.md](../research.md) (R1–R8). Verificación rápida de lo instalado:

```bash
node -v          # v24.19.0
pnpm -v          # 11.21.0
pnpm audit       # Esperado: 0 vulnerabilidades
```
