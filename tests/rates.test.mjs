import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    convert, formatMoney, normalizeRates, loadRatesCache, refreshRates,
    isStale, getSnapshot, RATES_TTL
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

test('formatMoney: USD histórico, VES y EUR con locale', () => {
    assert.equal(formatMoney(1234.56, 'USD', TASAS), '$1,234.56', 'el formato USD no cambia');
    // 65 × 872,3927 = 56.705,5255 → es-VE: punto de miles, coma decimal
    assert.equal(formatMoney(65, 'VES', TASAS), 'Bs 56.705,53');
    // 56.705,5255 / 977,2194 = 58,0272… → es-ES
    assert.equal(formatMoney(65, 'EUR', TASAS), '58,03 €');
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
