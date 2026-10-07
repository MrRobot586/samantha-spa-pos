import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Se define en línea (style="--x:…") en el HTML o en JS, no en un .css. */
const EN_LINEA = new Set(['--receipt-width']);

function listar(dir, ext, out = []) {
    for (const nombre of readdirSync(dir)) {
        const p = join(dir, nombre);
        if (statSync(p).isDirectory()) listar(p, ext, out);
        else if (nombre.endsWith(ext)) out.push(p);
    }
    return out;
}

const css = listar(join(RAIZ, 'css'), '.css');

test('hay hojas de estilo para revisar', () => {
    assert.ok(css.length >= 5, `solo encontré ${css.length} archivos CSS`);
});

test('toda variable usada con var(--x) está definida en el proyecto', () => {
    const definidas = new Set(EN_LINEA);
    // dónde se declaran: hojas CSS + estilos en línea del HTML/JS
    const fuentes = [...css, join(RAIZ, 'index.html'), ...listar(join(RAIZ, 'js'), '.js')];

    for (const archivo of fuentes) {
        const texto = readFileSync(archivo, 'utf8');
        for (const m of texto.matchAll(/(--[a-z0-9-]+)\s*:/gi)) definidas.add(m[1].toLowerCase());
    }

    const faltantes = new Map();
    for (const archivo of css) {
        const sinComentarios = readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of sinComentarios.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
            const v = m[1].toLowerCase();
            if (!definidas.has(v)) faltantes.set(v, (faltantes.get(v) || []).concat(archivo));
        }
    }

    assert.deepEqual(
        [...faltantes].map(([v, arch]) => `${v} (${[...new Set(arch)].map(a => a.replace(RAIZ + '/', '')).join(', ')})`),
        [],
        'variables CSS usadas sin definir: el gap/tamaño colapsa en silencio'
    );
});
