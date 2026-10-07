import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    convert, toUSD, formatMoney, normalizeRates, loadRatesCache, refreshRates,
    isStale, getSnapshot, bsRate, RATES_TTL
} from '../js/core/rates.js';
import { createMemoryBackend } from '../js/core/storage.js';
import { RATES_KEY } from '../js/core/config.js';

const TASAS = {
    usdBs: 872.3927,
    eurBs: 977.21940683,
    fecha: '2026-10-06T00:00:00-04:00',
    fetchedAt: Date.now(),
    offline: false
};

test('convert: USD es identidad, VES multiplica por la tasa, EUR divide', () => {
    assert.equal(convert(65, 'USD', TASAS), 65);
    assert.ok(Math.abs(convert(65, 'VES', TASAS) - 65 * 872.3927) < 1e-9);
    assert.ok(Math.abs(convert(65, 'EUR', TASAS) - (65 * 872.3927) / 977.21940683) < 1e-9);
});

test('convert sin tasa válida se queda en USD', () => {
    assert.equal(convert(65, 'VES', { usdBs: null }), 65, 'sin tasa → USD');
    assert.equal(convert(65, 'EUR', { usdBs: 872, eurBs: 0 }), 65, 'eurBs 0 → no divide');
    assert.equal(convert(NaN, 'VES', TASAS), 0, 'monto no numérico → 0');
});

test('bsRate: elige la tasa BCV correcta según la fuente', () => {
    assert.equal(bsRate('usd', TASAS), TASAS.usdBs, "fuente 'usd' → tasa del dólar");
    assert.equal(bsRate('eur', TASAS), TASAS.eurBs, "fuente 'eur' → tasa del euro");
    assert.equal(bsRate('usd', { usdBs: 100, eurBs: 500 }), 100);
    assert.equal(bsRate('eur', { usdBs: 100, eurBs: 500 }), 500);
});

test('convert a Bs usa la tasa BCV elegida; la vista en € no cambia', () => {
    const usd = convert(65, 'VES', TASAS, 'usd');
    const eur = convert(65, 'VES', TASAS, 'eur');
    assert.ok(Math.abs(usd - 65 * 872.3927) < 1e-9, 'Tasa USD → usdBs');
    assert.ok(Math.abs(eur - 65 * 977.21940683) < 1e-9, 'Tasa Euro → eurBs');

    // La tasa cruzada (€) es siempre usdBs/eurBs, sin importar la fuente.
    assert.equal(convert(65, 'EUR', TASAS, 'eur'), convert(65, 'EUR', TASAS, 'usd'),
        'la vista en € no depende de la fuente elegida');
});

test('convert a Bs con la fuente elegida sin tasa válida → USD', () => {
    assert.equal(convert(65, 'VES', { usdBs: 872, eurBs: null }, 'eur'), 65, 'eurBs ausente → USD');
    assert.equal(convert(65, 'VES', { usdBs: 872, eurBs: 0 }, 'eur'), 65, 'eurBs 0 → USD');
    assert.equal(convert(65, 'VES', { usdBs: null, eurBs: 977 }, 'usd'), 65, 'usdBs ausente → USD');
    assert.ok(convert(65, 'VES', { usdBs: null, eurBs: 977 }, 'eur') > 65, 'pero la otra tasa sí sirve');
});

test('toUSD: inverso según la fuente elegida', () => {
    assert.ok(Math.abs(toUSD(65 * 872.3927, 'VES', TASAS, 'usd') - 65) < 1e-9);
    assert.ok(Math.abs(toUSD(65 * 977.21940683, 'VES', TASAS, 'eur') - 65) < 1e-9);
    assert.equal(toUSD(100, 'VES', { usdBs: 872, eurBs: null }, 'eur'), 100, 'sin tasa → sin convertir');
    assert.equal(toUSD(100, 'USD', TASAS, 'eur'), 100, 'USD es identidad');
});

test('formatMoney: USD histórico, VES y EUR con locale', () => {
    assert.equal(formatMoney(1234.56, 'USD', TASAS), '$1,234.56', 'el formato USD no cambia');
    // 65 × 872,3927 = 56.705,5255 → es-VE: punto de miles, coma decimal
    assert.equal(formatMoney(65, 'VES', TASAS), 'Bs 56.705,53');
    // 56.705,5255 / 977,2194 = 58,0272… → es-ES
    assert.equal(formatMoney(65, 'EUR', TASAS), '58,03 €');
    // Con la tasa del euro como referencia: 65 × 977,2194 = 63.519,26
    assert.equal(formatMoney(65, 'VES', TASAS, 'eur'), 'Bs 63.519,26');
    assert.equal(formatMoney(65, 'EUR', TASAS, 'eur'), '58,03 €', '€ no cambia con la fuente');
});

test('formatMoney sin tasa → USD (la UI nunca se rompe)', () => {
    assert.equal(formatMoney(65, 'VES', { usdBs: null }), '$65.00');
    assert.equal(formatMoney(65, 'EUR', { usdBs: null, eurBs: null }), '$65.00');
});

test('normalizeRates: payload bueno, cambiado o vacío', () => {
    const payload = [
        { moneda: 'USD', promedio: 872.3927, fechaActualizacion: '2026-10-06T00:00:00-04:00' },
        { moneda: 'EUR', promedio: 977.21940683, fechaActualizacion: '2026-10-06T00:00:00-04:00' }
    ];
    const ok = normalizeRates(payload, 123);
    assert.equal(ok.usdBs, 872.3927);
    assert.equal(ok.eurBs, 977.21940683);
    assert.equal(ok.fetchedAt, 123);
    assert.equal(ok.fecha, '2026-10-06T00:00:00-04:00');
    assert.equal(ok.offline, false);

    assert.equal(normalizeRates({ message: 'rate limited' }), null, 'no es array');
    assert.equal(normalizeRates(null), null);
    assert.equal(normalizeRates([]), null, 'array vacío');
    assert.equal(normalizeRates([{ moneda: 'USD', promedio: 0 }, { moneda: 'EUR', promedio: 1 }]), null, 'USD 0 → null');
    assert.equal(normalizeRates([{ moneda: 'USD', promedio: 872 }]), null, 'falta EUR → null');
});

test('refreshRates: éxito actualiza snapshot y caché; fallo conserva y marca offline', async () => {
    const backend = createMemoryBackend();

    const ok = await refreshRates({
        fetcher: async () => ({
            ok: true,
            json: async () => [
                { moneda: 'USD', promedio: 900, fechaActualizacion: '2026-10-07T00:00:00-04:00' },
                { moneda: 'EUR', promedio: 1000, fechaActualizacion: '2026-10-07T00:00:00-04:00' }
            ]
        }),
        backend
    });
    assert.equal(ok, true);
    assert.equal(getSnapshot().usdBs, 900);
    assert.equal(getSnapshot().offline, false);
    assert.equal(JSON.parse(backend.getItem(RATES_KEY)).usdBs, 900, 'caché escrita');

    const fallo = await refreshRates({
        fetcher: async () => { throw new Error('sin red'); },
        backend
    });
    assert.equal(fallo, false);
    assert.equal(getSnapshot().usdBs, 900, 'conserva la última tasa buena');
    assert.equal(getSnapshot().offline, true, 'pero queda marcada como offline');

    const rota = await refreshRates({
        fetcher: async () => ({ ok: true, json: async () => ({ mensaje: 'sin tasas' }) }),
        backend
    });
    assert.equal(rota, false, 'payload inesperado → fallo controlado');
    assert.equal(getSnapshot().offline, true);
});

test('loadRatesCache: válida carga; corrupta o inválida no', () => {
    const buena = createMemoryBackend({
        [RATES_KEY]: JSON.stringify({ usdBs: 872.4, eurBs: 977.2, fecha: '2026-10-06', fetchedAt: 1700000000000 })
    });
    assert.equal(loadRatesCache(buena), true);
    assert.equal(getSnapshot().usdBs, 872.4);
    assert.equal(getSnapshot().offline, false);
    assert.equal(isStale(1700000000000 + RATES_TTL - 1), false, 'dentro del TTL → no vencida');
    assert.equal(isStale(1700000000000 + RATES_TTL + 1), true, 'fuera del TTL → vencida');

    const corrupta = createMemoryBackend({ [RATES_KEY]: '{roto' });
    assert.equal(loadRatesCache(corrupta), false);

    const inválida = createMemoryBackend({ [RATES_KEY]: JSON.stringify({ usdBs: -1, eurBs: 1000 }) });
    assert.equal(loadRatesCache(inválida), false, 'tasa no positiva → no se carga');

    assert.equal(loadRatesCache(null), false, 'sin backend');
});
