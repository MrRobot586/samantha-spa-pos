/* Tarjetas de comisiones por estilista. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';
import { commissionsBetween } from '../domain/reports.js';

export function renderCommissions() {
    const state = getState();
    const grid = document.getElementById('commissions-staff-grid');

    grid.innerHTML = state.staff.map(s => `
        <article class="card staff-card">
            <div>
                <div class="staff-card__head">
                    <div class="staff-card__avatar">${escapeHtml(s.name.charAt(0))}</div>
                    <div>
                        <h4 class="staff-card__name">${escapeHtml(s.name)}</h4>
                        <p class="staff-card__role">${escapeHtml(s.role)}</p>
                    </div>
                </div>
                <div class="staff-card__stats">
                    <div class="staff-card__stat">
                        <span>Servicios Atendidos:</span>
                        <strong>${s.salesCount}</strong>
                    </div>
                    <div class="staff-card__stat">
                        <span>Tasa de Comisión Base:</span>
                        <strong class="accent">${s.commissionRate}%</strong>
                    </div>
                </div>
            </div>
            <div class="staff-card__total">
                <span>Acumulado Por Pagar:</span>
                <strong>${money(s.totalCommissions)}</strong>
            </div>
        </article>`).join('');
}

/** Tabla de comisiones por rango de fechas (dos 'YYYY-MM-DD' o vacíos). */
export function renderCommissionsReport(desde = '', hasta = '') {
    const tbody = document.getElementById('commissions-report-list');
    if (!tbody) return;

    const rows = commissionsBetween(desde, hasta, getState());
    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Sin ventas en el período elegido.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td data-label="Estilista" class="cell-strong">${escapeHtml(r.staffName)}</td>
            <td data-label="Ventas">${r.sales}</td>
            <td data-label="Vendido" class="cell-amount">${money(r.totalUSD)}</td>
            <td data-label="Comisión" class="cell-amount accent">${money(r.commissionUSD)}</td>
        </tr>`).join('');
}
