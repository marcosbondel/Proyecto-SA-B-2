import re
import sys

manual_path = 'docs/user-manual.md'

with open(manual_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update in-text references
content = content.replace(
    '* **Contraseña inicial**: `DemoClave#02` (actualizada a nueva clave en Paso 17)',
    '* **Contraseña inicial**: `DemoClave#02` (actualizada a nueva clave en Paso 35)'
)
content = content.replace(
    '* **Datos Actualizados desde Mi Perfil (Paso 15)**:',
    '* **Datos Actualizados desde Mi Perfil (Pasos 32 y 33)**:'
)
content = content.replace(
    'como se detalla en el Paso 36 en la mesa de revisión',
    'como se detalla en el Paso 39 en la mesa de revisión'
)
content = content.replace(
    'quien fue registrado en el Módulo 1 y validado en el Paso 36',
    'quien fue registrado en el Módulo 1 y validado en el Paso 39'
)
content = content.replace(
    'iniciales que se apreciaban en el Paso 43',
    'iniciales que se apreciaban en el Paso 46'
)
content = content.replace(
    'depositados en ventanilla (Paso 24) más los Q 400.00 recibidos por transferencia desde Clara Cliente (Paso 31)',
    'depositados en ventanilla (Paso 52) más los Q 400.00 recibidos por transferencia desde Clara Cliente (Paso 59)'
)

# 2. Update Datos Maestros to include the EEGSA payment
eegsa_summary = '''  * **Pago de Servicio Eléctrico EEGSA Realizado (Pasos 29 al 31)**: `- Q 300.00` debitados en autoservicio de la cuenta Monetaria `...d6e822` (referencia: *"Esta cara la luz"*). Transacción ID: `983b187b-38c9-4738-8789-8775b2862293`, Pago ID: `627f542a-8133-4900-8d13-36547c85cc76`. Estado de la Saga: `COMPLETADA` (Aprobado). Saldos resultantes: Monetaria `Q 400.00`, Ahorro `Q 700.00`, Saldo Consolidado: `Q 1,100.00`.'''

target_datos_maestros = '''  * **Simulación de Falla y Compensación Saga (Paso 25)'''''
if target_datos_maestros in content:
    # insert eegsa_summary right after the simulación de falla bullet line
    pattern = r'(\* \*\*Simulación de Falla y Compensación Saga \(Paso 25\)\*\*: [^\n]+\n)'
    replacement = r'\1' + eegsa_summary + '\n'
    content = re.sub(pattern, replacement, content)
else:
    print('Warning: target_datos_maestros not found!')

# 3. Renumber all steps >= 29 to +3
def renumber_step(match):
    num = int(match.group(1))
    if num >= 29:
        return f'#### Paso {num + 3}:'
    return match.group(0)

content = re.sub(r'#### Paso (\d+):', renumber_step, content)

# 4. Content for Pasos 29, 30, 31 to insert after Paso 28
new_steps = '''#### Paso 29: Formulario de Pago de Servicios en Autoservicio — Factura de Electricidad EEGSA (`/pagos/nuevo`)

Desde el módulo de pagos (`/pagos`), el cliente pulsa el botón **"Nuevo pago"** (o **"Pagar un servicio"**) para liquidar una factura de servicios públicos mediante débito directo a sus cuentas bancarias. En este flujo, el titular programa el pago de su factura de energía eléctrica a favor de **EEGSA**.

![Formulario de pago de servicios EEGSA](images/user-manual/cliente-33-pago-eegsa-formulario.png)

##### Elementos y Valores del Formulario en Pantalla:
1. **Selección de Cuenta de Origen**:
   * **Cuenta origen**: Selector desplegable donde se selecciona la cuenta Monetaria `Monetaria · ****d6e822 · Q 700.00`.
   * **Saldo disponible**: Indicador reactivo que confirma `Q 700.00` disponibles (tras la distribución de fondos realizada en transferencias anteriores).
2. **Parámetros de la Factura**:
   * **Servicio público o factura**: Selector desplegable con el catálogo de entidades recaudadoras; se selecciona **`EEGSA · Energía eléctrica`**.
   * **Monto**: Selector numérico con controles de incremento y decremento (`- / +`), fijado en **`Q 300.00`**.
   * **Número de contrato o referencia**: Campo de texto libre donde el cliente ingresa la referencia de cobro: **`Esta cara la luz`** (descripción institucional: *"Número de contrato, de medidor o de línea. Es lo que le dice al prestador de quién es el pago"*).
3. **Idempotencia y Trazabilidad Transaccional**:
   * `CÓDIGO DE ESTA OPERACIÓN`: `21d5b01d-0103-427c-a902-3cc402cbb40f` (*"Se mantiene igual mientras reintentas, para que el sistema reconozca que es la misma operación"*). Previene que clics duplicados en la red generen dobles cobros de la misma factura.
4. **Tarjeta Informativa Lateral ("Qué pasa al pagar")**:
   * *"Un pago de servicio es una transferencia a la cuenta recaudadora del prestador (luz, agua, teléfono), y pasa por los mismos pasos: se descuenta de tu cuenta, se procesa el pago y se acredita al prestador."*
   * *"Si algo falla después del débito, el dinero se devuelve automáticamente mediante la compensación de la Saga."*
   * *"El saldo mostrado es el de la última consulta. Si alcanza o no se decide en el momento del cobro."*
   * *"Al terminar te llevamos al seguimiento de la transferencia, que es donde se ve cada paso."*
5. **Fundamento del Enunciado y Arquitectura de Resiliencia**:
   * **Especificación de Payment Service en el Enunciado**: El enunciado del proyecto define para `Payment Service` la responsabilidad de:
     * *Procesamiento de pagos externos o internos.*
     * *Validar operaciones financieras e integración con sistemas externos.*
     * *Notas SRE: Separación de la lógica de pagos, manejo de fallos externos y **simulación de sistemas bancarios reales**.*
   * **Diferenciación Fundamental respecto al Flujo de Compensación (Paso 25)**:
     * En los Pasos 24 y 25 se utilizó expresamente el sandbox de demostración (*"Rechazar el pago"*) para simular una caída catastrófica de la pasarela y verificar la ejecución de la **compensación contable de la Saga** (devolución íntegra de fondos).
     * En este pago de EEGSA, se procesa el **camino feliz (*Happy Path*) de liquidación real**: el procesador financiero aprueba la operación (`APROBADO`). Por consiguiente, la compensación **no** entra en ejecución; el débito se consolida legítimamente y los fondos pasan a la cuenta recaudadora de EEGSA sin reversiones.
6. **Acción**:
   * Botón principal: **"Pagar servicio"**.

---

#### Paso 30: Monitor de la Saga del Pago de Electricidad — Liquidación Exitosa y Aprobación (`/transferencias/[id]`)

Al ordenar el pago, el frontend redirige automáticamente al monitor en tiempo real de la transferencia distribuida (`http://localhost:3010/transferencias/983b187b-38c9-4738-8789-8775b2862293`), permitiendo auditar la ejecución de cada fase de la Saga coreografiada.

![Monitor de la Saga del pago de electricidad completado](images/user-manual/cliente-34-pago-eegsa-saga-completada.png)

##### Análisis del Flujo y Métricas en Pantalla:
1. **Encabezado y Metadatos de la Operación**:
   * **Identificador de Transacción**: `983b187b-38c9-4738-8789-8775b2862293`.
   * Botón de acción rápida: **"Nueva transferencia"**.
   * **MONTO**: **`Q 300.00`**.
   * **Solicitada**: `3/09/2026, 9:44 p. m.` | **Última actualización**: `3/09/2026, 9:44 p. m.`.
2. **Tarjeta "Avance de la transferencia" (Orquestación Saga)**:
   * Badge superior derecho: en color verde **`COMPLETADA`**.
   * Leyenda de éxito: *"El dinero llegó a la cuenta de destino."*
   * **Línea de tiempo secuencial (Stepper con checks negros)**:
     * `(✓) Solicitada`: *El sistema aceptó la solicitud.* `transaction-service` verificó parámetros e inició la Saga.
     * `(✓) Débito`: *Se descuenta de la cuenta de origen.* `account-service` debitó `Q 300.00` bajo `SELECT ... FOR UPDATE` de la cuenta monetaria `...d6e822`.
     * `(✓) Pago`: *Se procesa el pago entre cuentas.* `payment-service` validó la transacción con el proveedor externo de energía.
     * `(✓) Completada`: *El dinero llegó al destino.* Se acreditó el monto a la cuenta recaudadora del facturador EEGSA.
3. **Tarjeta "RESULTADO DEL PAGO" (Resolución Externa)**:
   * Badge verde: **`APROBADO`**.
   * Título y detalle: **"El pago se aprobó"** (*"Se ordenó el crédito a la cuenta de destino."*).
   * **Número del pago (`paymentId`)**: `627f542a-8133-4900-8d13-36547c85cc76`.
   * **Resuelto**: `3/09/2026, 9:44 p. m.`.
4. **Trazabilidad y Enlaces**:
   * Enlace: **"Ver mis cuentas"**.
   * **CÓDIGO DE SEGUIMIENTO DE LA TRANSFERENCIA**: `17925a72-913c-4cb4-96e8-08febcebea7e` [Copiar].

---

#### Paso 31: Historial de Pagos de Servicios del Cliente con Factura Liquidada (`/pagos`)

El cliente regresa a la vista principal de **Pagos** (`http://localhost:3010/pagos`) para constatar que su factura ha sido formalmente registrada en el historial histórico de servicios.

![Historial de pagos del cliente con servicio completado](images/user-manual/cliente-35-pago-eegsa-historial.png)

##### Elementos y Registros Observados en Pantalla:
1. **Encabezado y Acciones**:
   * Título: **Pagos** (*"Paga servicios y consulta los pagos que ya hiciste."*).
   * Botón superior: **"Nuevo pago"**.
2. **Tabla "Historial de pagos"**:
   * **FECHA**: `3/09/2026, 9:44 p. m.`
   * **SERVICIO**: `EEGSA · Energía eléctrica` acompañado del badge amarillo **`Externo`**, certificando que la liquidación se ejecutó hacia una empresa prestadora externa de servicios.
   * **ESTADO**: Badge verde **`Completada`**.
   * **MONTO**: **`Q 300.00`**.
   * **Acción**: Enlace **`Ver →`** que permite abrir en cualquier momento el monitor y comprobante de la transferencia.
3. **Controles de Trazabilidad**:
   * Botón **"Actualizar"** para refrescar la lista reactivamente sin recargar la página.
   * **CÓDIGO DE SEGUIMIENTO**: `0bc550dc-3ce8-4d9b-a228-158a5c80840a` [Copiar].
4. **Tarjeta Explicativa ("Por qué un pago aparece como transferencia")**:
   * *"Cada prestador tiene una cuenta recaudadora en este banco, así que pagar un servicio es transferirle dinero. Por eso el detalle de un pago se ve en la pantalla de la transferencia: es la misma operación, con los mismos pasos y con la misma devolución automática si el pago falla."*
5. **Efecto Neto en el Balance del Cliente**:
   * **Cuenta Monetaria (`...d6e822`)**: Saldo previo `Q 700.00` - `Q 300.00` = **`Q 400.00`**.
   * **Cuenta de Ahorro (`afd97145...`)**: Saldo intacto en **`Q 700.00`** (sin afectación por tratarse de cuentas bancarias aisladas).
   * **Patrimonio Consolidado**: **`Q 1,100.00`** en custodia institucional.

---

'''

# Insert new_steps right after Paso 28
# Find end of Paso 28 block
p28_marker = '#### Paso 28: Módulo de Pago de Servicios Públicos del Cliente (`/pagos`)'
next_step_marker = '#### Paso 32: Perfil de Usuario' # (since it was renumbered from 29 to 32)

idx_p28 = content.find(p28_marker)
idx_p32 = content.find(next_step_marker)

if idx_p28 == -1 or idx_p32 == -1:
    print(f'Error finding markers: idx_p28={idx_p28}, idx_p32={idx_p32}')
    sys.exit(1)

# Find the separator line between Paso 28 and Paso 32
part_before = content[:idx_p32]
part_after = content[idx_p32:]

# Ensure clean separation
new_content = part_before + new_steps + part_after

with open(manual_path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Successfully updated docs/user-manual.md with Pasos 29, 30, and 31, and renumbered remaining steps!')
