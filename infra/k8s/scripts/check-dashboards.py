#!/usr/bin/env python3
"""
Comprueba que los nueve dashboards, las reglas y las alertas del stack de
observabilidad consultan algo que existe — y, con `--live`, que cada consulta
DEVUELVE algo contra un stack con datos.

POR QUE EXISTE. Un panel cuya consulta no encuentra nada no da error: sale
vacío para siempre y parece que el sistema no tiene datos. La auditoría de T-60
encontró cinco de golpe que ninguna comprobación vio:

  - tres dashboards filtraban Loki por `environment`, una etiqueta que Loki no
    indexa — los paneles de logs salían en blanco;
  - un panel filtraba `result="FAILED"` y el código emite `failed`;
  - el enlace log → traza (`TraceID`) y el de `correlationId` llegaban a
    Grafana con la URL VACÍA: Grafana expande `${…}` como variable de entorno
    en sus archivos de aprovisionamiento, y `${__value.raw}` sin escapar se
    convertía en una cadena vacía;
  - el enlace de `correlationId` consultaba `{job=~".+"}`, etiqueta que no
    existe;
  - la anotación de despliegues se disparaba con cada escalado del HPA.

Lo estático (sin clúster, corre en CI):
  1. Cada JSON es válido y trae uid, title, panels, templating, annotations.
  2. Cada `slo:`/`sli:` citado por un panel o una alerta está GRABADO.
  3. Cada alerta tiene `runbook_url` hacia un archivo que existe en
     `docs/operations/runbooks/`.
  4. Cada datasource que nombra un dashboard está aprovisionado.
  5. Cada selector de Loki (paneles, variables, alertas, enlaces) usa SÓLO
     etiquetas de la lista cerrada de `otlp_config`.
  6. Cada métrica que nombra una consulta PromQL existe: es una regla grabada,
     está en `docs/sre/telemetry-catalog.md`, o es de la infraestructura que el
     catálogo nombra en §2.9 (kube-state-metrics, cAdvisor, RabbitMQ).
  7. Los valores de etiqueta tienen la forma que el código emite: `result`,
     `outcome`, `operation`, … en minúsculas (el código hace `toLowerCase()`),
     los valores que el catálogo enumera, y ningún `le="5"` (Prometheus guarda
     `le="5.0"`).
  8. Ningún `$` sin escapar en el aprovisionamiento de Grafana, salvo las
     variables de entorno que el pod recibe de verdad.
  9. Ninguna anotación usa `kube_deployment_metadata_generation`.
  Además escribe (`--emit-promql-rules`) un archivo de reglas con TODA consulta
  PromQL de los dashboards y las alertas, para que `promtool check rules` valide
  su sintaxis sin un Prometheus.

Lo vivo (`--live`, contra un stack con tráfico — lo usa `obs-kind.sh`):
  10. Ejecuta cada PromQL, LogQL y TraceQL de los nueve dashboards (paneles,
      variables y anotaciones) y FALLA si devuelve vacío.
  11. Ejecuta cada consulta de alerta y falla si el datasource la rechaza.
  12. Pregunta a Grafana: los enlaces de los datasources llegaron con su
      `${__value.raw}`, las alertas y los contact points cargaron, y están los
      nueve dashboards.
  13. Con `--redaction-secret`, que ni Tempo ni Loki guardan el secreto que se
      les mandó en un `?token=` — y que sí guardaron la línea y el span que lo
      llevaban, porque una ausencia sin presencia no prueba nada.

Sólo usa la biblioteca estándar y PyYAML.
"""

import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import yaml

FALLOS = []


def fallo(msg):
    FALLOS.append(msg)
    print(f'   FALLO: {msg}')


def ok(msg):
    print(f'   OK  {msg}')


# --------------------------------------------------------------------------
# Carga
# --------------------------------------------------------------------------

def cargar(chart):
    with open(os.path.join(chart, 'values.yaml'), encoding='utf-8') as f:
        values = yaml.safe_load(f)
    dashboards = {}
    for ruta in sorted(glob.glob(os.path.join(chart, 'dashboards', '*.json'))):
        nombre = os.path.basename(ruta)
        try:
            with open(ruta, encoding='utf-8') as f:
                dashboards[nombre] = json.load(f)
        except ValueError as e:
            fallo(f'{nombre}: JSON inválido: {e}')
    return values, dashboards


def reglas_grabadas(values):
    grupos = values['prometheus']['serverFiles']['recording_rules.yml']['groups']
    return [r for g in grupos for r in g['rules']]


def alertas(values):
    grupos = values['grafana']['alerting']['rules.yaml']['groups']
    return [r for g in grupos for r in g['rules']]


def datasources(values):
    return values['grafana']['datasources']['datasources.yaml']['datasources']


def etiquetas_indexadas_loki(values):
    cfg = values['loki']['loki']['limits_config']['otlp_config']['resource_attributes']
    nombres = set()
    for bloque in cfg['attributes_config']:
        if bloque['action'] == 'index_label':
            nombres.update(a.replace('.', '_') for a in bloque['attributes'])
    return nombres


# --------------------------------------------------------------------------
# Las consultas de los dashboards, con su origen
# --------------------------------------------------------------------------

class Consulta:
    def __init__(self, origen, tipo, expr, clase='panel'):
        self.origen = origen  # p. ej. '07-logs.json · panel 59 «Logs» · A'
        self.tipo = tipo      # prometheus | loki | tempo
        self.expr = expr
        self.clase = clase    # panel | variable | anotacion | alerta | enlace


def uid_de(ds):
    if isinstance(ds, dict):
        return ds.get('uid')
    return ds


def tipo_de(ds, por_uid):
    uid = uid_de(ds)
    if isinstance(ds, dict) and ds.get('type') in ('prometheus', 'loki', 'tempo'):
        return ds['type']
    return por_uid.get(uid)


def consultas_de_dashboards(dashboards, por_uid):
    salida = []
    for nombre, d in dashboards.items():
        paneles = []
        for p in d.get('panels', []):
            paneles.append(p)
            paneles.extend(p.get('panels', []))
        for p in paneles:
            for t in p.get('targets', []) or []:
                ds = t.get('datasource') or p.get('datasource')
                tipo = tipo_de(ds, por_uid)
                expr = t.get('expr') or t.get('query')
                if tipo and expr:
                    salida.append(Consulta(
                        f'{nombre} · panel {p.get("id")} «{p.get("title")}» · {t.get("refId")}',
                        tipo, expr))
        for v in d.get('templating', {}).get('list', []):
            if v.get('type') != 'query':
                continue
            tipo = tipo_de(v.get('datasource'), por_uid)
            q = v.get('query')
            if tipo == 'loki' and isinstance(q, dict):
                expr = json.dumps({'label': q.get('label'), 'stream': q.get('stream', '')})
            elif isinstance(q, dict):
                expr = q.get('query')
            else:
                expr = q
            if tipo and expr:
                salida.append(Consulta(f'{nombre} · variable ${v["name"]}', tipo, expr, 'variable'))
        for a in d.get('annotations', {}).get('list', []):
            tipo = tipo_de(a.get('datasource'), por_uid)
            if tipo in ('prometheus', 'loki') and a.get('expr'):
                salida.append(Consulta(f'{nombre} · anotación «{a.get("name")}»', tipo, a['expr'], 'anotacion'))
    return salida


def consultas_de_alertas(values, por_uid):
    salida = []
    for r in alertas(values):
        for dato in r.get('data', []):
            tipo = por_uid.get(dato.get('datasourceUid'))
            expr = (dato.get('model') or {}).get('expr')
            if tipo and expr:
                salida.append(Consulta(f'alerta {r["title"]} · {dato["refId"]}', tipo, expr, 'alerta'))
    return salida


def consultas_de_enlaces(values):
    """Las consultas de Loki que viven DENTRO de los datasources."""
    salida = []
    for ds in datasources(values):
        jd = ds.get('jsonData') or {}
        for df in jd.get('derivedFields', []) or []:
            if df.get('datasourceUid') == 'bank-loki':
                salida.append(Consulta(f'datasource {ds["name"]} · enlace {df["name"]}', 'loki', df['url'], 'enlace'))
        t2l = jd.get('tracesToLogsV2') or {}
        if t2l.get('query'):
            salida.append(Consulta(f'datasource {ds["name"]} · tracesToLogsV2', 'loki', t2l['query'], 'enlace'))
    return salida


# --------------------------------------------------------------------------
# Sustitución de variables de Grafana
# --------------------------------------------------------------------------

def sustituir(expr, entorno):
    valores = {
        'environment': entorno,
        'service': '.+',
        'level': '.+',
        'correlationId': '.+',
        'traceId': '.+',
    }
    # Las variables internas de Grafana que pueden aparecer en un enlace.
    expr = expr.replace('$${', '${')
    expr = re.sub(r'\$\{__[a-zA-Z_.]+(\[[^\]]*\])?[^}]*\}', 'x', expr)
    for k, v in valores.items():
        expr = expr.replace('${' + k + '}', v).replace('$' + k, v)
    return expr


# --------------------------------------------------------------------------
# Un lector mínimo de PromQL: lo justo para sacar nombres de métrica y
# selectores. No pretende ser un parser; `promtool` valida la sintaxis.
# --------------------------------------------------------------------------

PROMQL_PALABRAS = set('''
sum min max avg count stddev stdvar topk bottomk quantile count_values group limitk limit_ratio
rate irate increase delta idelta deriv changes resets predict_linear holt_winters
histogram_quantile histogram_count histogram_sum histogram_fraction histogram_avg
avg_over_time min_over_time max_over_time sum_over_time count_over_time last_over_time
quantile_over_time stddev_over_time stdvar_over_time present_over_time absent absent_over_time
label_replace label_join vector scalar time timestamp clamp clamp_min clamp_max abs ceil floor
round sort sort_desc sort_by_label sort_by_label_desc sqrt exp ln log2 log10 sgn
by without on ignoring group_left group_right and or unless bool offset inf nan
day_of_month day_of_week day_of_year days_in_month hour minute month year
'''.split())

RE_CADENA = re.compile(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`[^`]*`')
RE_SELECTOR = re.compile(r'([A-Za-z_:][A-Za-z0-9_:]*)?\s*\{([^{}]*)\}')
RE_MATCHER = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)\s*(=~|!~|!=|=)\s*"((?:[^"\\]|\\.)*)"')


def metricas_promql(expr):
    s = RE_CADENA.sub('""', expr)
    s = re.sub(r'\{[^{}]*\}', '{}', s)
    s = re.sub(r'\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)', ' ', s)
    s = re.sub(r'\[[^\]]*\]', '[]', s)
    tokens = re.findall(r'(?<![A-Za-z0-9_:.])[A-Za-z_:][A-Za-z0-9_:]*', s)
    return {t for t in tokens if t not in PROMQL_PALABRAS}


def selectores_promql(expr):
    """[(métrica o None, [(etiqueta, operador, valor)])]"""
    salida = []
    for m in RE_SELECTOR.finditer(expr):
        salida.append((m.group(1), RE_MATCHER.findall(m.group(2))))
    return salida


def selectores_logql(expr):
    """Los selectores de stream de LogQL: `{…}` que no son `{{…}}` de plantilla."""
    sin_plantillas = re.sub(r'\{\{.*?\}\}', '', expr)
    salida = []
    for m in re.finditer(r'\{([^{}]*)\}', sin_plantillas):
        cuerpo = m.group(1).strip()
        matchers = RE_MATCHER.findall(cuerpo)
        if matchers:
            salida.append(matchers)
    return salida


# --------------------------------------------------------------------------
# El catálogo de telemetría
# --------------------------------------------------------------------------

def leer_catalogo(raiz):
    ruta = os.path.join(raiz, 'docs', 'sre', 'telemetry-catalog.md')
    with open(ruta, encoding='utf-8') as f:
        texto = f.read()
    nombres = set()
    valores = {}  # (métrica, etiqueta) -> {valores}
    for linea in texto.splitlines():
        if not linea.startswith('|'):
            continue
        celdas = [c.strip() for c in linea.strip('|').split('|')]
        if len(celdas) < 5:
            continue
        prom = re.findall(r'`([a-z][a-z0-9_]*)`', celdas[-1])
        nombres.update(prom)
        etiquetas = celdas[-2]
        for m in re.finditer(r'`([a-z_.]+)`\s*\(([^)]*)\)', etiquetas):
            vals = set(re.findall(r'`([^`]+)`', m.group(2)))
            for metrica in prom:
                valores[(metrica, m.group(1).replace('.', '_'))] = vals
    return nombres, valores


# Las de la infraestructura que el catálogo nombra en §2.9 sin listar serie a
# serie: kube-state-metrics, cAdvisor, RabbitMQ y la auto-telemetría.
PREFIJOS_INFRA = ('kube_', 'container_', 'rabbitmq_', 'otelcol_', 'prometheus_', 'up')

# Las etiquetas cuyo valor el código pasa por `toLowerCase()`
# (`apps/services/*/src/infrastructure/telemetry/*.ts`).
EN_MINUSCULAS = {'result', 'outcome', 'operation', 'processing', 'source', 'action',
                 'bank_delivery_outcome', 'status', 'severity'}


def base_metrica(nombre):
    return re.sub(r'_(bucket|count|sum)$', '', nombre)


# --------------------------------------------------------------------------
# Comprobaciones estáticas
# --------------------------------------------------------------------------

def estatico(raiz, chart, values, dashboards, emitir):
    por_uid = {ds['uid']: ds['type'] for ds in datasources(values)}
    grabadas = {r['record']: r for r in reglas_grabadas(values)}
    todas = (consultas_de_dashboards(dashboards, por_uid) + consultas_de_alertas(values, por_uid)
             + consultas_de_enlaces(values))

    print('== 1. Los dashboards son JSON válido y están completos')
    for nombre, d in dashboards.items():
        faltan = [k for k in ('uid', 'title', 'panels', 'templating', 'annotations') if k not in d]
        if faltan:
            fallo(f'{nombre}: falta {", ".join(faltan)}')
        elif not d['panels']:
            fallo(f'{nombre}: no tiene paneles')
        else:
            ok(nombre)

    print('\n== 2. Cada SLI/SLO citado está grabado')
    print(f'   {len(grabadas)} reglas grabadas')
    cita = re.compile(r'\b(?:slo|sli):[a-z0-9_]+:[a-z0-9_]+\b')
    malas = 0
    for c in todas:
        if c.tipo != 'prometheus':
            continue
        for n in sorted(set(cita.findall(c.expr))):
            if n not in grabadas:
                fallo(f'{c.origen}: cita {n}, que ninguna regla graba')
                malas += 1
    for r in grabadas.values():
        for n in sorted(set(cita.findall(r['expr']))):
            if n not in grabadas:
                fallo(f'regla {r["record"]}: cita {n}, que ninguna regla graba')
                malas += 1
    if not malas:
        ok('ninguna consulta se inventa un SLI')

    print('\n== 3. Cada alerta tiene su runbook en docs/operations/runbooks/')
    for r in alertas(values):
        url = (r.get('annotations') or {}).get('runbook_url', '')
        m = re.search(r'/blob/[^/]+/(docs/operations/runbooks/[A-Za-z0-9_.-]+\.md)', url)
        if not m:
            fallo(f'alerta {r["title"]}: runbook_url «{url}» no apunta a docs/operations/runbooks/')
        elif not os.path.isfile(os.path.join(raiz, m.group(1))):
            fallo(f'alerta {r["title"]}: {m.group(1)} no existe')
        else:
            ok(f'{r["title"]} -> {m.group(1)}')

    print('\n== 4. Cada datasource citado está aprovisionado')
    conocidos = set(por_uid) | {'grafana', '-- Grafana --', '__expr__', None}
    malos = set()

    def recorrer(nodo, nombre):
        if isinstance(nodo, dict):
            if 'datasource' in nodo:
                uid = uid_de(nodo['datasource'])
                if isinstance(uid, str) and uid.startswith('$'):
                    pass
                elif uid not in conocidos:
                    malos.add((nombre, uid))
            for v in nodo.values():
                recorrer(v, nombre)
        elif isinstance(nodo, list):
            for v in nodo:
                recorrer(v, nombre)

    for nombre, d in dashboards.items():
        recorrer(d, nombre)
    for r in alertas(values):
        for dato in r.get('data', []):
            if dato.get('datasourceUid') not in conocidos:
                malos.add((f'alerta {r["title"]}', dato.get('datasourceUid')))
    for nombre, uid in sorted(malos, key=str):
        fallo(f'{nombre}: datasource «{uid}» no está aprovisionado')
    if not malos:
        ok(f'todos citan uno de: {", ".join(sorted(por_uid))}')

    print('\n== 5. Loki sólo se consulta por etiquetas que indexa')
    indexadas = etiquetas_indexadas_loki(values)
    print(f'   indexadas: {", ".join(sorted(indexadas))}')
    malas = 0
    for c in todas:
        if c.tipo != 'loki':
            continue
        expr = c.expr
        if c.clase == 'variable':
            q = json.loads(expr)
            if q['label'] not in indexadas:
                fallo(f'{c.origen}: lista valores de «{q["label"]}», que no es etiqueta')
                malas += 1
            expr = q['stream']
        for matchers in selectores_logql(expr):
            for etiqueta, _op, _val in matchers:
                if etiqueta not in indexadas:
                    fallo(f'{c.origen}: el selector usa «{etiqueta}», que Loki no indexa '
                          f'(es metadato estructurado: va después de un `|`)')
                    malas += 1
    if not malas:
        ok('ningún selector de stream usa una etiqueta que no existe')

    print('\n== 6. Cada métrica citada existe')
    catalogo, valores_catalogo = leer_catalogo(raiz)
    malas = 0
    fuentes = [c for c in todas if c.tipo == 'prometheus' and c.clase != 'variable']
    fuentes += [Consulta(f'regla {r["record"]}', 'prometheus', r['expr'], 'regla') for r in grabadas.values()]
    for c in fuentes:
        for n in sorted(metricas_promql(c.expr)):
            if n in grabadas or base_metrica(n) in catalogo or n.startswith(PREFIJOS_INFRA):
                continue
            fallo(f'{c.origen}: «{n}» no es una regla grabada ni está en telemetry-catalog.md')
            malas += 1
    if not malas:
        ok('todas son reglas grabadas, del catálogo o de la infraestructura de §2.9')

    print('\n== 7. Los valores de etiqueta tienen la forma que el código emite')
    malas = 0
    for c in fuentes:
        for metrica, matchers in selectores_promql(c.expr):
            for etiqueta, op, valor in matchers:
                if etiqueta == 'le' and op == '=' and re.fullmatch(r'\d+', valor):
                    fallo(f'{c.origen}: le="{valor}" no existe — Prometheus guarda le="{valor}.0"; usa le=~"{valor}(\\\\.0+)?"')
                    malas += 1
                if not metrica or not metrica.startswith(('bank_', 'messaging_')):
                    continue
                if etiqueta in EN_MINUSCULAS and re.search(r'[A-Z]', re.sub(r'\\.', '', valor)):
                    fallo(f'{c.origen}: {metrica}{{{etiqueta}{op}"{valor}"}} — el código emite «{etiqueta}» en minúsculas')
                    malas += 1
                permitidos = valores_catalogo.get((base_metrica(metrica), etiqueta))
                if permitidos and op in ('=', '!=') and valor not in permitidos:
                    fallo(f'{c.origen}: {metrica}{{{etiqueta}="{valor}"}} — el catálogo sólo lista {sorted(permitidos)}')
                    malas += 1
    if not malas:
        ok('ningún filtro busca un valor que el código no emite')

    print('\n== 8. Ningún «$» sin escapar en el aprovisionamiento de Grafana')
    env_reales = set((values['grafana'].get('envValueFrom') or {}).keys()) | set((values['grafana'].get('env') or {}).keys())
    texto = yaml.safe_dump({'datasources': values['grafana']['datasources'],
                            'alerting': values['grafana']['alerting']}, allow_unicode=True, width=10_000)
    malas = 0
    for m in re.finditer(r'(?<!\$)\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)', texto):
        nombre = m.group(1).strip('{}')
        if nombre in env_reales:
            continue
        inicio = texto.rfind('\n', 0, m.start()) + 1
        fallo(f'«${m.group(1)}» se expandirá como variable de entorno (y llegará vacío): '
              f'{texto[inicio:m.end() + 20].strip()[:140]} — escríbelo «$$»')
        malas += 1
    if not malas:
        ok(f'sólo se expanden las variables que el pod recibe: {", ".join(sorted(env_reales)) or "ninguna"}')

    print('\n== 9. Las anotaciones de despliegue no se disparan con el HPA')
    malas = 0
    for nombre, d in dashboards.items():
        if 'kube_deployment_metadata_generation' in json.dumps(d):
            fallo(f'{nombre}: usa kube_deployment_metadata_generation, que sube también cuando el HPA escala')
            malas += 1
        anot = [a for a in d['annotations']['list'] if a.get('name') == 'Despliegues']
        if len(anot) != 1:
            fallo(f'{nombre}: no tiene la anotación «Despliegues»')
            malas += 1
    if not malas:
        ok('los nueve marcan ReplicaSets nuevos (sólo un rollout los crea)')

    if emitir:
        reglas = []
        for i, c in enumerate(x for x in todas if x.tipo == 'prometheus' and x.clase != 'variable'):
            reglas.append({'record': f'check:consulta_{i:03d}', 'expr': sustituir(c.expr, 'prod'),
                           'labels': {'origen': c.origen[:200]}})
        with open(emitir, 'w', encoding='utf-8') as f:
            yaml.safe_dump({'groups': [{'name': 'consultas-de-dashboards-y-alertas', 'rules': reglas}]},
                           f, allow_unicode=True, sort_keys=False)
        print(f'\n   {len(reglas)} consultas PromQL escritas en {emitir} para promtool')

    return todas


# --------------------------------------------------------------------------
# Comprobaciones vivas
# --------------------------------------------------------------------------

def http_json(url, auth=None, timeout=20):
    req = urllib.request.Request(url)
    if auth:
        import base64
        req.add_header('Authorization', 'Basic ' + base64.b64encode(auth.encode()).decode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            cuerpo = r.read().decode('utf-8', 'replace')
            return r.status, cuerpo
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except (urllib.error.URLError, OSError) as e:
        return 0, str(e)


def q(base, ruta, **params):
    return f'{base.rstrip("/")}{ruta}?{urllib.parse.urlencode(params)}'


def ejecutar(c, args):
    """Devuelve (estado, detalle): 'ok', 'vacio' o 'error'."""
    ahora = int(time.time())
    expr = sustituir(c.expr, args.environment)
    if c.tipo == 'prometheus':
        m = re.fullmatch(r'\s*label_values\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*', expr)
        if m:
            code, body = http_json(q(args.prometheus, f'/api/v1/label/{m.group(1)}/values'))
            if code != 200:
                return 'error', f'HTTP {code}: {body[:200]}'
            datos = json.loads(body).get('data') or []
            return ('ok', f'{len(datos)} valores') if datos else ('vacio', 'sin valores')
        if c.clase == 'anotacion':
            url = q(args.prometheus, '/api/v1/query_range', query=expr, start=ahora - 3600, end=ahora, step=60)
        else:
            url = q(args.prometheus, '/api/v1/query', query=expr)
        code, body = http_json(url)
        if code != 200:
            return 'error', f'HTTP {code}: {body[:200]}'
        res = json.loads(body)['data']['result']
        if c.clase == 'alerta':
            return 'ok', f'{len(res)} series (una alerta puede no tener datos)'
        return ('ok', f'{len(res)} series') if res else ('vacio', 'sin series')
    if c.tipo == 'loki':
        if c.clase == 'variable':
            v = json.loads(expr)
            code, body = http_json(q(args.loki, f'/loki/api/v1/label/{v["label"]}/values',
                                     query=v['stream'], start=f'{ahora - 3600}000000000', end=f'{ahora}000000000'))
            if code != 200:
                return 'error', f'HTTP {code}: {body[:200]}'
            datos = json.loads(body).get('data') or []
            return ('ok', f'{", ".join(datos)}') if datos else ('vacio', 'sin valores')
        code, body = http_json(q(args.loki, '/loki/api/v1/query_range', query=expr, limit=5,
                                 start=f'{ahora - 1800}000000000', end=f'{ahora}000000000', step=60))
        if code != 200:
            return 'error', f'HTTP {code}: {body[:200]}'
        res = json.loads(body)['data']['result']
        if c.clase == 'alerta':
            return 'ok', f'{len(res)} series (una alerta puede no tener datos)'
        return ('ok', f'{len(res)} streams/series') if res else ('vacio', 'sin resultados')
    if c.tipo == 'tempo':
        code, body = http_json(q(args.tempo, '/api/search', q=expr, start=ahora - 3600, end=ahora, limit=5))
        if code != 200:
            return 'error', f'HTTP {code}: {body[:200]}'
        trazas = json.loads(body).get('traces') or []
        return ('ok', f'{len(trazas)} trazas') if trazas else ('vacio', 'sin trazas')
    return 'error', f'tipo desconocido {c.tipo}'


def vivo(values, dashboards, todas, args):
    print('\n== 10-11. Cada consulta de los dashboards devuelve datos; cada alerta se deja ejecutar')
    pendientes = [c for c in todas if c.clase != 'enlace']
    if args.skip:
        omitir = re.compile(args.skip)
        for c in [c for c in pendientes if omitir.search(c.origen)]:
            print(f'   OMITIDA (--skip): {c.origen}')
        pendientes = [c for c in pendientes if not omitir.search(c.origen)]
    limite = time.time() + args.wait
    resultados = {}
    while True:
        for c in pendientes:
            resultados[c] = ejecutar(c, args)
        vacias = [c for c in pendientes if resultados[c][0] == 'vacio']
        if not vacias or time.time() > limite:
            break
        print(f'   … {len(vacias)} consultas aún vacías; reintento en 15 s (las reglas grabadas tardan un ciclo)')
        pendientes = vacias
        time.sleep(15)
    for c in sorted(resultados, key=lambda x: x.origen):
        estado, detalle = resultados[c]
        if estado == 'ok':
            ok(f'{c.origen} — {detalle}')
        elif estado == 'vacio':
            fallo(f'{c.origen} — VACÍA: {sustituir(c.expr, args.environment)}')
        else:
            fallo(f'{c.origen} — RECHAZADA: {detalle}')

    if args.grafana:
        print('\n== 12. Grafana cargó lo que el chart aprovisiona')
        for uid in ('bank-loki', 'bank-tempo'):
            code, body = http_json(q(args.grafana, f'/api/datasources/uid/{uid}'), args.grafana_auth)
            if code != 200:
                fallo(f'datasource {uid}: HTTP {code}')
                continue
            jd = json.loads(body).get('jsonData') or {}
            for df in jd.get('derivedFields') or []:
                if '${__value.raw}' in (df.get('url') or ''):
                    ok(f'{uid}: el enlace {df["name"]} llegó con su ${{__value.raw}}: {df["url"]}')
                else:
                    fallo(f'{uid}: el enlace {df["name"]} llegó como «{df.get("url")}» — Grafana expandió el $')
            t2l = (jd.get('tracesToLogsV2') or {}).get('query')
            if t2l is not None:
                if '${__span.traceId}' in t2l:
                    ok(f'{uid}: tracesToLogsV2 llegó intacta')
                else:
                    fallo(f'{uid}: tracesToLogsV2 llegó como «{t2l}»')
        esperadas = {r['title'] for r in alertas(values)}
        code, body = http_json(q(args.grafana, '/api/v1/provisioning/alert-rules'), args.grafana_auth)
        cargadas = {r['title'] for r in json.loads(body)} if code == 200 else set()
        if esperadas <= cargadas:
            ok(f'las {len(esperadas)} alertas están cargadas')
        else:
            fallo(f'faltan alertas en Grafana: {sorted(esperadas - cargadas)} (HTTP {code})')
        esperados = {cp['name'] for cp in values['grafana']['alerting']['contactpoints.yaml']['contactPoints']}
        code, body = http_json(q(args.grafana, '/api/v1/provisioning/contact-points'), args.grafana_auth)
        cargados = {cp['name'] for cp in json.loads(body)} if code == 200 else set()
        if esperados <= cargados:
            ok(f'contact points: {", ".join(sorted(esperados))}')
        else:
            fallo(f'faltan contact points: {sorted(esperados - cargados)} (HTTP {code})')
        code, body = http_json(q(args.grafana, '/api/search', type='dash-db'), args.grafana_auth)
        uids = {d['uid'] for d in json.loads(body)} if code == 200 else set()
        esperados = {d['uid'] for d in dashboards.values()}
        if esperados <= uids:
            ok(f'los {len(esperados)} dashboards están cargados')
        else:
            fallo(f'faltan dashboards: {sorted(esperados - uids)} (HTTP {code})')

    if args.redaction_secret:
        print('\n== 13. El secreto de un `?token=` no llega ni a Tempo ni a Loki')
        secreto = args.redaction_secret
        ahora = int(time.time())
        limite = time.time() + args.wait
        while True:
            code, traza = http_json(q(args.tempo, f'/api/traces/{args.redaction_trace_id}'))
            if code == 200 or time.time() > limite:
                break
            time.sleep(10)
        if code != 200:
            fallo(f'Tempo no tiene la traza de redacción {args.redaction_trace_id} (HTTP {code}): la ausencia no prueba nada')
        elif args.redaction_marker not in traza:
            fallo('la traza de redacción está en Tempo pero sin su span marcador')
        elif secreto in traza:
            fallo(f'Tempo GUARDÓ «{secreto}»: el procesador transform/redact_spans no lo quitó')
        elif '[REDACTED]' not in traza:
            fallo('la traza no contiene «[REDACTED]»: ¿llegaron los atributos?')
        else:
            ok(f'Tempo tiene la traza, con «[REDACTED]» y sin «{secreto}» '
               f'({traza.count("[REDACTED")} valores redactados)')

        while True:
            code, lineas = http_json(q(args.loki, '/loki/api/v1/query_range',
                                       query=f'{{k8s_namespace_name=~".+"}} |= "{args.redaction_marker}"', limit=20,
                                       start=f'{ahora - 1800}000000000', end=f'{ahora}000000000'))
            hay = code == 200 and json.loads(lineas)['data']['result']
            if hay or time.time() > limite:
                break
            time.sleep(10)
        if not hay:
            fallo(f'Loki no tiene la línea marcada «{args.redaction_marker}» (HTTP {code}): la ausencia no prueba nada')
        elif secreto in lineas:
            fallo(f'Loki GUARDÓ «{secreto}» en la línea marcada: transform/redact_logs no lo quitó')
        elif '[REDACTED]' not in lineas:
            fallo('la línea marcada está en Loki sin «[REDACTED]»')
        else:
            ok(f'Loki tiene la línea marcada, con «[REDACTED]» y sin «{secreto}» (texto y metadato estructurado)')
        code, todo = http_json(q(args.loki, '/loki/api/v1/query_range',
                                 query=f'{{k8s_namespace_name="{args.redaction_namespace}"}} |= "{secreto}"', limit=5,
                                 start=f'{ahora - 1800}000000000', end=f'{ahora}000000000'))
        # Acotado al namespace de los productores: en un clúster de prueba
        # reutilizado puede haber líneas de otra corrida que citen el mismo
        # texto por otra razón, y eso no dice nada de la redacción.
        if code == 200 and not json.loads(todo)['data']['result']:
            ok(f'ninguna línea de {args.redaction_namespace} en la última media hora contiene «{secreto}»')
        else:
            fallo(f'hay líneas con «{secreto}» en Loki (HTTP {code}): {todo[:300]}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--root', default=os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..')))
    ap.add_argument('--chart')
    ap.add_argument('--emit-promql-rules')
    ap.add_argument('--live', action='store_true')
    ap.add_argument('--prometheus')
    ap.add_argument('--loki')
    ap.add_argument('--tempo')
    ap.add_argument('--grafana')
    ap.add_argument('--grafana-auth')
    ap.add_argument('--environment', default='prod')
    ap.add_argument('--wait', type=int, default=240)
    ap.add_argument('--skip', help='regex sobre el origen de las consultas que no se ejecutan')
    ap.add_argument('--redaction-secret')
    ap.add_argument('--redaction-trace-id')
    ap.add_argument('--redaction-marker')
    ap.add_argument('--redaction-namespace', default='prod')
    args = ap.parse_args()
    chart = args.chart or os.path.join(args.root, 'infra', 'k8s', 'helm', 'bank-observability')

    values, dashboards = cargar(chart)
    todas = estatico(args.root, chart, values, dashboards, args.emit_promql_rules)
    if args.live:
        for k in ('prometheus', 'loki', 'tempo'):
            if not getattr(args, k):
                ap.error(f'--live necesita --{k}')
        vivo(values, dashboards, todas, args)

    print()
    if FALLOS:
        print(f'RESULTADO: {len(FALLOS)} comprobación(es) fallaron.')
        sys.exit(1)
    print('RESULTADO: los dashboards, las reglas y las alertas citan lo que existe'
          + (' y cada consulta devuelve datos.' if args.live else '.'))


if __name__ == '__main__':
    main()
