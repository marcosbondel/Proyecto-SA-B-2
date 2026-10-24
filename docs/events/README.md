# Mensajes y eventos — Fase III

La envolvente, el broker y las máquinas de estados conectan los cinco servicios sin llamadas HTTP internas. T-61 contrastó el inventario con `@bank/contracts` el 2026-10-21: **134 contratos: 58 comandos, 43 eventos y 33 respuestas**.

| Documento | Contenido |
| --- | --- |
| [envelope](envelope.md) | Identidad, correlación, causalidad, idempotencia y contexto W3C de transporte. |
| [catalog](catalog.md) | Inventario completo y campos de primer nivel derivados de los contratos/JSON Schema; enlaces a la fuente ejecutable. |
| [topology](topology.md) | Cuatro exchanges topic, doce colas lógicas, colas privadas Gateway, retry y DLQ. |
| [saga-transfer](saga-transfer.md) | Saga de seis estados, KYC, cobro, crédito y compensación; interbancario mantiene reserva durante TIMEOUT. |
| [examples](examples/) | Tres ejemplos históricos de Saga generados y validados contra contratos; no son evidencia de una ejecución del sistema. |

La semántica y los límites viven en [dominio](../domain/README.md). El protocolo externo, su autenticación y recuperación viven en [INTERBANK](../operations/INTERBANK.md); el OpenAPI oficial permanece separado e inalterado.

## Fuentes y reproducción

Desde la raíz:

```bash
pnpm --filter @bank/contracts build
pnpm --filter @bank/contracts schema:emit
pnpm --filter @bank/contracts docs:catalog
pnpm --filter @bank/contracts docs:examples
```

**Limitación comprobada:** `docs:catalog` falla con `Flow listing covers 48 of 134 contracts`. Su mapa de flujos/prosa no se actualizó junto a las extensiones. Para esta revisión, un adaptador temporal generó el catálogo completo a partir de los 134 metadatos/JSON Schema actuales, diferenciando los 48 del mapa y los 86 sin clasificación allí. No se modificaron contratos ni scripts; reparar el generador es trabajo pendiente de #167. El catálogo indica su procedencia y no inventa la semántica que falta al generador.

En Windows, `schema:emit` y `docs:examples` usan importación dinámica de ruta absoluta sin convertir a URL y pueden fallar con `ERR_UNSUPPORTED_ESM_URL_SCHEME`. T-61 usó un loader ESM temporal que convierte rutas `C:\…` a `file:///…`, sin modificar los scripts. El workspace local también necesitó el compilador instalado directamente por indisponibilidad de la descarga de pnpm fijado. Estas adaptaciones de verificación no certifican la versión de toolchain exigida por CI.

Los tres ejemplos se regeneraron con sus validaciones ejecutables: happy-path 9, rejected 5 y compensated 9 mensajes. No incluyen la puerta KYC completa, todas las colas de auditoría ni el protocolo interbancario actual; no usarlos como recuento del flujo real. La fuente de verdad de cada forma/refinamiento es el Zod enlazado; JSON Schema y tabla no capturan todos los refinamientos entre campos.

No publicar los JSON Schema en un servicio externo ni incluir secretos reales en ejemplos. Las pruebas contra infraestructura requieren bases/broker de prueba separados; un suite skipped no prueba entrega, locks, outbox o unicidad.


## Adaptador documental reproducible de T-61

El adaptador completo está en el bloque siguiente; puede eliminarse `tmp/` sin perder la receta. Usa sólo la biblioteca estándar de Python y los JSON Schema recién emitidos. No modifica aplicación, contratos, clasificador de flujos ni el catálogo de dominio. En modo predeterminado **compara** el catálogo; `--write` regenera únicamente `docs/events/catalog.md`.

1. Compilar y emitir JSON Schema con los dos primeros comandos anteriores. No seguir a `docs:catalog` como si su error fuese éxito: su reparación permanece pendiente de #167.
2. Copiar este bloque a un archivo temporal, por ejemplo `tmp/t61-catalog.py`, y ejecutar `python tmp/t61-catalog.py` desde la raíz. La comprobación cubre los 134 nombres, categorías, productores, consumidores, origen TypeScript y tablas de campos emitidas. Admite el espaciado de tablas que Prettier cambia, sin alterar los valores.
3. Si la fuente cambió, revisar el diff y ejecutar `python tmp/t61-catalog.py --write`. El adaptador fija la línea base de T-61 (134 contratos / 48 clasificados); un cambio de cantidad exige revisar la documentación y no se acepta silenciosamente.

<details>
<summary>Adaptador de biblioteca estándar (Python)</summary>

```python
import json,re,pathlib,collections,sys
root=pathlib.Path.cwd(); package=root/'apps/packages/contracts'; idx=json.loads((package/'schema/index.json').read_text()); contracts=idx['contracts']; counts=collections.Counter(c['category'] for c in contracts)
script=(package/'scripts/emit-catalog-doc.mjs').read_text(encoding='utf-8'); flows=set(re.findall(r"'([^']+\.v\d+)'",script[script.index('const FLOWS'):script.index('function typeOf')]))
paths={}
for p in (package/'src/events').rglob('*.ts'):
 for name in re.findall(r"name:\s*'([^']+)'",p.read_text(encoding='utf-8')):paths[name]=p.relative_to(root).as_posix()
assert len(contracts)==134 and len(flows)==48
assert all(c['name'] in paths for c in contracts),[c['name'] for c in contracts if c['name'] not in paths]
header=f'''# Catálogo actual de mensajes — Fase III

> Revisión T-61, 2026-10-21. **{len(contracts)} contratos ejecutables**: {counts['command']} comandos, {counts['event']} eventos y {counts['reply']} respuestas. Derivado de `schema/index.json` y los JSON Schema emitidos desde Zod, después de compilar el paquete. Las declaraciones de origen siguen siendo la autoridad.

El generador versionado `pnpm --filter @bank/contracts docs:catalog` falla con `Flow listing covers 48 of 134 contracts`: su lista de flujos y prosa cubre 48. Para T-61 un adaptador documental temporal produjo este inventario completo con los metadatos y campos emitidos, sin modificar scripts, esquemas ni contratos. **86 contratos carecen de clasificación de flujo en ese generador**; aquí se identifican como extensiones por familia, sin atribuirles precondiciones o efectos no verificados. El defecto del generador queda pendiente de #167.

La regeneración usa: compilación de `@bank/contracts` → `schema:emit` → lectura ordenada de los 134 metadatos y sus propiedades `required`, tipos y validaciones → enlace al archivo que declara cada nombre. No editar tablas de campos a mano. La clasificación `base` sólo significa que el nombre figura en la lista de 48 del generador; no significa que el contrato o su payload sigan en Fase I.

Las tablas enumeran campos de primer nivel; los objetos, uniones y refinamientos cruzados se consultan en el contrato enlazado. JSON Schema no expresa todos los refinamientos Zod; esta proyección no sustituye la validación ejecutable. Los identificadores `messageId`, `correlationId` y la propagación W3C se explican en [envelope](envelope.md); la responsabilidad funcional está en [dominio](../domain/message-catalog.md).

## Inventario

| Mensaje | Categoría | Productor | Consumidores declarados | Flujo del generador |
| --- | --- | --- | --- | --- |
'''
lines=[header.rstrip()]
for c in contracts:lines.append(f"| `{c['name']}` | {c['category']} | {c['producer']} | {', '.join(c['consumers'])} | {'base' if c['name'] in flows else 'extensión sin mapa de flujo'} |")

def typename(n):
 if 'const' in n:return '`'+str(n['const'])+'`'
 if 'enum' in n:return ' \\| '.join('`'+str(x)+'`' for x in n['enum'])
 if 'anyOf' in n or 'oneOf' in n:return ' \\| '.join(typename(x) for x in n.get('anyOf',n.get('oneOf',[])))
 t=n.get('type','any')
 if t=='array':return 'array de '+typename(n.get('items',{}))
 return n.get('format',t)
def validations(n):
 keys=['minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems','pattern','additionalProperties']
 return '; '.join(k+'='+str(n[k]).replace('|','\\|') for k in keys if k in n) or '—'
for family in sorted(set(c['name'].split('.')[0] for c in contracts)):
 lines+=['',f'## Familia `{family}`','']
 for c in contracts:
  if not c['name'].startswith(family+'.'):continue
  schema=json.loads((package/'schema'/c['schema']).read_text());required=set(schema.get('required',[]))
  lines += [f"### `{c['name']}`",'',f"**{c['category']}** · {c['producer']} → {', '.join(c['consumers'])}. Exchange `bank.{dict(command='commands',event='events',reply='replies')[c['category']]}`; routing key `{c['name']}`.",'',f"Contrato: [`{pathlib.Path(paths[c['name']]).name}`](../../{paths[c['name']]}).",'', '| Campo | Tipo / valores | Obligatorio | Validación emitida |','| --- | --- | --- | --- |']
  props=schema.get('properties',{})
  if not props:lines+=['| — | Unión/variante: consultar contrato | — | — |']
  for n,v in props.items():lines += [f"| `{n}` | {typename(v)} | {'sí' if n in required else 'no'} | {validations(v)} |"]
  lines+=['']
generated = '\n'.join(lines) + '\n'
target = root / 'docs/events/catalog.md'
def normalized(value):
    # Ignore table padding changed by Prettier, never payload text or escaped pipes.
    return '\n'.join(
        re.sub(r'(?<!\\)\s*\|\s*', ' | ', line.strip())
        if line.lstrip().startswith('|') else line.rstrip()
        for line in value.replace('\r\n', '\n').splitlines()
    ).rstrip()
if '--write' in sys.argv:
    target.write_text(generated, encoding='utf-8')
else:
    assert normalized(target.read_text(encoding='utf-8-sig')) == normalized(generated), (
        'El catálogo difiere de los esquemas emitidos; revisar y regenerar con --write'
    )
print('134 contratos verificados: 58 comandos, 43 eventos, 33 respuestas; mapa 48/134')
```

</details>

### Compatibilidad de importación ESM en Windows

Si los scripts originales fallan al importar una ruta `C:`, copiar este loader a un archivo temporal `.mjs` y añadir `--experimental-loader ./ruta/loader.mjs` al comando `node` que ejecuta el script. El ajuste sólo transforma una ruta absoluta a su URL de archivo; no cambia los scripts versionados ni los contratos. `docs:catalog` sigue fallando por su cobertura aunque el loader resuelva Windows.

```javascript
import { pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (/^[A-Za-z]:[\\/]/.test(specifier)) {
    return nextResolve(pathToFileURL(specifier).href, context);
  }
  return nextResolve(specifier, context);
}
```

Los ajustes anteriores generan o verifican documentación local. Ninguno acredita que el stack esté desplegado, que una integración haya pasado ni que un resultado de prueba omitido haya ejecutado sus aserciones.
