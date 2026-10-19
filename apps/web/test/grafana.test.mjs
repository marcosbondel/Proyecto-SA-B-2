import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  TEMPO_DATASOURCE_UID,
  TRACE_LOOKBACK,
  grafanaBase,
  grafanaTraceUrl,
} from '../app/lib/grafana.ts';

const TRAZA = '4bf92f3577b34da6a3ce929d0e0e4736';

/** Lo que Explore recibe en `panes`, ya decodificado. */
function panesOf(url) {
  return JSON.parse(new URL(url).searchParams.get('panes'));
}

describe('el origen de Grafana', () => {
  test('acepta http y https, y quita la barra final', () => {
    assert.equal(grafanaBase('http://localhost:3002'), 'http://localhost:3002');
    assert.equal(grafanaBase('http://localhost:3002/'), 'http://localhost:3002');
    assert.equal(grafanaBase('https://grafana.example.com//'), 'https://grafana.example.com');
    assert.equal(grafanaBase('  https://grafana.example.com  '), 'https://grafana.example.com');
  });

  test('conserva un prefijo, porque Grafana puede servirse bajo uno', () => {
    assert.equal(grafanaBase('https://ops.example.com/grafana/'), 'https://ops.example.com/grafana');
  });

  test('sin valor, o con algo que no es un origen web, no hay Grafana', () => {
    for (const bad of [undefined, null, '', '   ', 42, 'grafana', '/grafana', 'ftp://x', 'javascript:alert(1)', 'data:text/html,x']) {
      assert.equal(grafanaBase(bad), null, String(bad));
    }
  });
});

describe('el enlace a una traza', () => {
  test('abre Explore sobre Tempo buscando esa traza', () => {
    const url = grafanaTraceUrl('http://localhost:3002', TRAZA);

    assert.ok(url.startsWith('http://localhost:3002/explore?'));

    const pane = panesOf(url).a;

    assert.equal(pane.datasource, TEMPO_DATASOURCE_UID);
    assert.equal(pane.queries.length, 1);
    assert.deepEqual(pane.queries[0].datasource, { type: 'tempo', uid: TEMPO_DATASOURCE_UID });
    assert.equal(pane.queries[0].queryType, 'traceql');
    assert.equal(pane.queries[0].query, TRAZA);
    assert.deepEqual(pane.range, { from: TRACE_LOOKBACK, to: 'now' });
  });

  /** Si el uid cambia en el chart de observabilidad, el enlace deja de abrir nada. */
  test('el uid de Tempo es el que provisiona el chart de observabilidad', async () => {
    const values = await readFile(
      new URL('../../../infra/k8s/helm/bank-observability/values.yaml', import.meta.url),
      'utf8',
    );

    assert.match(values, new RegExp(`type: tempo\\s*\\n\\s*uid: ${TEMPO_DATASOURCE_UID}\\b`));
  });

  test('la ventana cubre lo que Tempo retiene, siete días', () => {
    assert.equal(TRACE_LOOKBACK, 'now-7d');
  });

  test('respeta el prefijo de Grafana y no duplica la barra', () => {
    const url = grafanaTraceUrl('https://ops.example.com/grafana/', TRAZA);

    assert.ok(url.startsWith('https://ops.example.com/grafana/explore?'));
    assert.ok(!url.includes('//explore'));
  });

  test('tolera mayúsculas y espacios en el identificador', () => {
    assert.equal(
      panesOf(grafanaTraceUrl('http://localhost:3002', ` ${TRAZA.toUpperCase()} `)).a.queries[0].query,
      TRAZA,
    );
  });

  test('sin Grafana configurado no hay enlace: queda el texto copiable', () => {
    assert.equal(grafanaTraceUrl('', TRAZA), null);
    assert.equal(grafanaTraceUrl(undefined, TRAZA), null);
    assert.equal(grafanaTraceUrl('no es una url', TRAZA), null);
  });

  test('sin una traza de verdad no hay enlace', () => {
    for (const bad of [null, undefined, '', 'abc', '0'.repeat(32), `${TRAZA}0`, TRAZA.slice(1), 'z'.repeat(32)]) {
      assert.equal(grafanaTraceUrl('http://localhost:3002', bad), null, String(bad));
    }
  });

  /** Lo que sale de aquí termina en un `href`: nada que no sea hex puede colarse. */
  test('un identificador con intención de inyección no construye una URL', () => {
    assert.equal(grafanaTraceUrl('http://localhost:3002', `${TRAZA}"}],"x":["`), null);
    assert.equal(grafanaTraceUrl('http://localhost:3002', '"><script>alert(1)</script>'), null);
  });

  test('el esquema peligroso en la configuración nunca llega a un href', () => {
    assert.equal(grafanaTraceUrl('javascript:alert(1)//', TRAZA), null);
  });
});
