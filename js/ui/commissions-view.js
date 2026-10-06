/* Tarjetas de comisiones por estilista. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';

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
