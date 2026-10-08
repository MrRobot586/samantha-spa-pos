/* Genera los favicon del proyecto a partir de assets/favicon.svg: PNG de 16/32/48,
 * apple-touch-icon de 180 (a sangre, sin transparencia: iOS aplica su máscara)
 * y un favicon.ico que incrusta esos PNG. Sin dependencias: usa Chrome headless
 * por CDP, igual que smoke.mjs.
 *
 * Uso: node generar-favicon.mjs   (requiere google-chrome-stable)
 * Los binarios quedan commiteados: el repo no tiene build ni etapa de assets. */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(RAIZ, 'assets');
const SVG = readFileSync(join(ASSETS, 'favicon.svg'), 'utf8');
const esperar = ms => new Promise(r => setTimeout(r, ms));

function chrome() {
    const bin = process.env.CHROME_BIN || 'google-chrome-stable';
    const p = spawn(bin, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
        '--user-data-dir=' + join(tmpdir(), 'chrome-favicon-' + Date.now()),
        '--disable-extensions', 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return new Promise((ok, ko) => {
        let err = '';
        const t = setTimeout(() => ko(new Error('chrome sin DevTools: ' + err.slice(-300))), 15000);
        p.stderr.on('data', d => {
            err += d;
            const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
            if (m) { clearTimeout(t); ok({ proc: p, ws: m[1] }); }
        });
    });
}

/** SVG con ancho/alto exactos para que el navegador lo rasterice a ese tamaño. */
function svgConTamano(n, fullBleed = false) {
    let out = SVG.replace('viewBox="0 0 64 64"', `viewBox="0 0 64 64" width="${n}" height="${n}"`);
    if (fullBleed) {
        // Sin radios ni margen: el icono de inicio de iOS va a sangre.
        out = out.replace('<rect x="2" y="2" width="60" height="60" rx="14"',
            '<rect x="0" y="0" width="64" height="64" rx="0"');
    }
    return out;
}

function pagina(svg) {
    return '<!doctype html><html><head><meta charset="utf-8">'
        + '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>'
        + '</head><body>' + svg + '</body></html>';
}

/** Contenedor ICO (PNG incrustados) con las entradas ICONDIR/ICONDIRENTRY. */
function icoDe(pngs) {
    const cabecera = Buffer.alloc(6);
    cabecera.writeUInt16LE(0, 0);
    cabecera.writeUInt16LE(1, 2);           // tipo: icono
    cabecera.writeUInt16LE(pngs.length, 4);
    const entradas = [];
    let offset = 6 + pngs.length * 16;
    for (const { size, buf } of pngs) {
        const e = Buffer.alloc(16);
        e.writeUInt8(size >= 256 ? 0 : size, 0);
        e.writeUInt8(size >= 256 ? 0 : size, 1);
        e.writeUInt8(0, 2);                  // paleta
        e.writeUInt8(0, 3);                  // reservado
        e.writeUInt16LE(1, 4);               // planos
        e.writeUInt16LE(32, 6);              // bits por píxel
        e.writeUInt32LE(buf.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += buf.length;
        entradas.push(e);
    }
    return Buffer.concat([cabecera, ...entradas, ...pngs.map(p => p.buf)]);
}

async function main() {
    const chr = await chrome();
    const ws = new WebSocket(chr.ws);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pend = new Map();
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
        const i = ++id;
        pend.set(i, m => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
        ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    // Fondo transparente: hace falta para las esquinas redondeadas del icono.
    await send('Emulation.setDefaultBackgroundColorOverride',
        { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);

    const render = async (svg, size) => {
        await send('Emulation.setDeviceMetricsOverride',
            { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sessionId);
        const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(pagina(svg));
        await send('Page.navigate', { url }, sessionId);
        for (let i = 0; i < 30; i++) {
            const r = await send('Runtime.evaluate',
                { expression: 'document.readyState === "complete"' }, sessionId);
            if (r.result.value) break;
            await esperar(50);
        }
        await esperar(120);
        const shot = await send('Page.captureScreenshot', {
            format: 'png', fromSurface: true,
            clip: { x: 0, y: 0, width: size, height: size, scale: 1 }
        }, sessionId);
        return Buffer.from(shot.data, 'base64');
    };

    /** Pinta el PNG en el navegador y devuelve el alfa de su esquina (0 = transparente). */
    const alphaEsquina = async buf => {
        const b64 = buf.toString('base64');
        const r = await send('Runtime.evaluate', {
            expression: `(async () => {
                const img = new Image();
                img.src = 'data:image/png;base64,${b64}';
                await img.decode();
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                return ctx.getImageData(0, 0, 1, 1).data[3];
            })()`,
            awaitPromise: true, returnByValue: true
        }, sessionId);
        return r.result.value;
    };

    const png16 = await render(svgConTamano(16), 16);
    const png32 = await render(svgConTamano(32), 32);
    const png48 = await render(svgConTamano(48), 48);
    const apple = await render(svgConTamano(180, true), 180);

    const alfaRedondo = await alphaEsquina(png32);
    const alfaApple = await alphaEsquina(apple);
    if (alfaRedondo !== 0) {
        throw new Error(`esquina del icono opaca (alfa ${alfaRedondo}): falta transparencia`);
    }
    if (alfaApple !== 255) {
        throw new Error(`apple-touch-icon con transparencia (alfa ${alfaApple}): debe ir a sangre`);
    }

    const archivos = [
        ['favicon-16x16.png', png16],
        ['favicon-32x32.png', png32],
        ['apple-touch-icon.png', apple],
        ['favicon.ico', icoDe([{ size: 16, buf: png16 }, { size: 32, buf: png32 }, { size: 48, buf: png48 }])]
    ];
    for (const [nombre, buf] of archivos) {
        writeFileSync(join(ASSETS, nombre), buf);
        console.log(`assets/${nombre}  ${buf.length} bytes`);
    }

    chr.proc.kill();
    ws.close();
    console.log('FAVICON OK');
}

main().catch(err => {
    console.error('FAVICON CON FALLOS: ' + err.message);
    process.exit(1);
});
