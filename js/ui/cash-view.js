/* Caja & Cortes (solo admin): acciones de la sesión, resumen con KPIs,
 * retiros y historial de cortes. Todo el dinero se muestra en la moneda
 * activa de visualización (money()) sobre montos almacenados en USD. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';
import { cashSummary } from '../domain/cash.js';
import { closuresBetween } from '../domain/reports.js';
import { methodLabel } from '../domain/payments.js';

/** Suma todos los métodos de un desglose (ignora `count`). */
function totalVentas(ventas) {
    return Object.entries(ventas)
        .reduce((a, [k, v]) => (k === 'count' ? a : a + v), 0);
}

/** "Efectivo $X · Débito $Y · …" solo con los métodos que tienen monto. */
function desgloseVentas(ventas) {
    return Object.entries(ventas)
        .filter(([k, v]) => k !== 'count' && v > 0)
        .map(([k, v]) => `${methodLabel(k)} ${money(v)}`)
        .join(' · ');
}

function fmt(iso, conHora = true) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return conHora
        ? d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function metricCard(label, value, icon, iconMod, note) {
    return `
        <div class="card metric-card">
            <div class="metric-card__row">
                <div>
                    <p class="metric-card__label">${label}</p>
                    <h3 class="metric-card__value">${value}</h3>
                </div>
                <div class="metric-card__icon metric-card__icon--${iconMod}">
                    <i class="fa-solid ${icon}"></i>
                </div>
            </div>
            <span class="metric-card__note">${note}</span>
        </div>`;
}

export function renderCash() {
    const state = getState();
    const s = cashSummary(state);

    // Acciones según el estado de la sesión
    const actions = document.getElementById('cash-actions');
    if (s.open) {
        actions.innerHTML = `
            <button type="button" data-action="cash-withdraw-modal" class="btn btn--neutral">
                <i class="fa-solid fa-money-bill-transfer"></i> <span>Retiro</span>
            </button>
            <button type="button" data-action="cash-close-modal" class="btn btn--success">
                <i class="fa-solid fa-scale-balanced"></i> <span>Cerrar caja</span>
            </button>`;
    } else {
        actions.innerHTML = `
            <button type="button" data-action="cash-open-modal" class="btn btn--brand">
                <i class="fa-solid fa-vault"></i> <span>Abrir caja</span>
            </button>`;
    }

    // Resumen
    const ventasTotal = totalVentas(s.ventas);
    const summary = document.getElementById('cash-summary');

    if (s.open) {
        summary.innerHTML = [
            metricCard('Estado de la Caja', 'Abierta', 'fa-vault', 'success',
                `Desde ${fmt(s.openedAt)}`),
            metricCard('Fondo Inicial', money(s.fondoInicial), 'fa-coins', 'brand',
                'Efectivo con que se abrió'),
            metricCard('Ventas (sesión)', money(ventasTotal), 'fa-receipt', 'warning',
                `${desgloseVentas(s.ventas) || 'Sin ventas'} · ${s.ventas.count} ventas`),
            metricCard('Efectivo Esperado', money(s.esperado), 'fa-money-bill-wave', 'danger',
                `Fondo + efectivo − ${money(s.retiros)} en retiros`)
        ].join('');
    } else {
        summary.innerHTML = [
            metricCard('Estado de la Caja', 'Cerrada', 'fa-lock', 'danger',
                'Abre la caja para poder cobrar'),
            metricCard('Fondo Inicial', '—', 'fa-coins', 'brand',
                'Sin sesión activa'),
            metricCard('Ventas (sesión)', '—', 'fa-receipt', 'warning',
                'Sin sesión activa'),
            metricCard('Efectivo Esperado', '—', 'fa-money-bill-wave', 'danger',
                'Sin sesión activa')
        ].join('');
    }

    // Retiros de la sesión
    const tbodyW = document.getElementById('cash-withdrawals-list');
    if (s.withdrawals.length === 0) {
        tbodyW.innerHTML = '<tr><td colspan="4" class="empty-cell">No hay retiros en esta sesión.</td></tr>';
    } else {
        tbodyW.innerHTML = [...s.withdrawals].reverse().map(w => `
            <tr>
                <td class="cell-amount">${money(w.amount)}</td>
                <td>${escapeHtml(w.note || '—')}</td>
                <td>${fmt(w.at)}</td>
                <td>${escapeHtml(w.by)}</td>
            </tr>`).join('');
    }

    // Historial de cortes (filtrable por rango de fechas)
    const desde = document.getElementById('closure-from')?.value || '';
    const hasta = document.getElementById('closure-to')?.value || '';
    const closures = closuresBetween(desde, hasta, state);
    const tbodyC = document.getElementById('cash-closures-list');
    if (closures.length === 0) {
        tbodyC.innerHTML = '<tr><td colspan="5" class="empty-cell">No hay cortes en el período elegido.</td></tr>';
    } else {
        tbodyC.innerHTML = closures.map(c => {
            const neg = c.diferenciaUSD < 0;
            const clase = neg ? 'cash-diff cash-diff--neg' : 'cash-diff cash-diff--pos';
            return `
                <tr>
                    <td>${fmt(c.closedAt)}<br><span class="cell-meta">${escapeHtml(c.closedByName)}</span></td>
                    <td class="cell-amount">${money(c.totalUSD)}<br><span class="cell-meta">${c.txCount} ventas</span></td>
                    <td class="cell-amount">${money(c.esperadoUSD)}</td>
                    <td class="cell-amount">${money(c.contadoUSD)}</td>
                    <td class="cell-amount ${clase}">${money(c.diferenciaUSD)}</td>
                </tr>`;
        }).join('');
    }
}

/** Rellena el resumen del modal de corte (esperado/ventas/retiros). */
export function fillCashClosePreview() {
    const s = cashSummary();
    const ventasTotal = totalVentas(s.ventas);
    const el = document.getElementById('cash-close-preview');
    if (!el) return;
    el.innerHTML = `
        <div class="cash-close-preview__row"><span>Ventas de la sesión</span><strong>${money(ventasTotal)}</strong></div>
        <div class="cash-close-preview__row"><span>Dinero físico (Efectivo + Divisa)</span><strong>${money((s.ventas.cash || 0) + (s.ventas.divisa || 0))}</strong></div>
        <div class="cash-close-preview__row"><span>Fondo inicial</span><strong>${money(s.fondoInicial)}</strong></div>
        <div class="cash-close-preview__row"><span>Retiros</span><strong>− ${money(s.retiros)}</strong></div>
        <div class="cash-close-preview__row cash-close-preview__row--total"><span>Efectivo esperado</span><strong>${money(s.esperado)}</strong></div>`;
}
