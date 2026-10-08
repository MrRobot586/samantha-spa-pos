/* Guardas estáticas de los favicon: los archivos referenciados en index.html
 * existen (nada de 404 en CI) y los binarios miden lo que declaran. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');

function leer(nombre) {
    return readFileSync(join(RAIZ, 'assets', nombre));
}

/** Dimensiones de un PNG leídas del chunk IHDR (sin dependencias). */
function tamanoPNG(buf) {
    assert.equal(buf.readUInt32BE(0), 0x89504e47, 'firma PNG inválida');
    assert.equal(buf.toString('ascii', 12, 16), 'IHDR', 'el primer chunk no es IHDR');
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('index.html referencia favicon de assets/ que existen', () => {
    const refs = [...html.matchAll(/href="(assets\/[^"]+)"/g)].map(m => m[1]);

    assert.ok(refs.includes('assets/favicon.svg'), 'falta el icono SVG');
    assert.ok(refs.includes('assets/apple-touch-icon.png'), 'falta el apple-touch-icon');
    assert.ok(!html.includes('href="data:,"'), 'sigue el favicon de relleno data:,');
    for (const ref of refs) {
        assert.ok(existsSync(join(RAIZ, ref)), `referenciado pero no existe: ${ref}`);
    }
});

test('los PNG del favicon miden lo que declaran sus enlaces', () => {
    assert.deepEqual(tamanoPNG(leer('favicon-16x16.png')), { w: 16, h: 16 });
    assert.deepEqual(tamanoPNG(leer('favicon-32x32.png')), { w: 32, h: 32 });
    // iOS pide 180×180 a sangre (sin transparencia en las esquinas).
    assert.deepEqual(tamanoPNG(leer('apple-touch-icon.png')), { w: 180, h: 180 });
});

test('favicon.ico es un contenedor ICO con 16, 32 y 48 px', () => {
    const buf = leer('favicon.ico');
    assert.equal(buf.readUInt16LE(0), 0, 'ICONDIR.reserved');
    assert.equal(buf.readUInt16LE(2), 1, 'ICONDIR.type = icono');
    const count = buf.readUInt16LE(4);
    assert.equal(count, 3, 'tres imágenes incrustadas');
    const tallas = Array.from({ length: count }, (_, i) => buf.readUInt8(6 + i * 16) || 256);
    assert.deepEqual(tallas, [16, 32, 48]);
    // Cada entrada apunta a un PNG (firma) dentro del mismo archivo.
    for (let i = 0; i < count; i++) {
        const offset = buf.readUInt32LE(6 + i * 16 + 12);
        assert.equal(buf.readUInt32BE(offset), 0x89504e47, `entrada ${i} sin PNG`);
    }
});

test('el SVG del favicon es propio: sin fuentes ni recursos externos', () => {
    const svg = readFileSync(join(RAIZ, 'assets', 'favicon.svg'), 'utf8');
    assert.match(svg, /viewBox="0 0 64 64"/);
    assert.match(svg, /<rect[^>]*rx="14"/, 'rectángulo redondeado');
    assert.match(svg, /stroke="#fff"/, 'la «S» va en trazo blanco');
    assert.ok(!/<text|font-family|href="http/.test(svg), 'no depende de tipografías ni de la red');
});
