/* Tabla de inventario híbrido con reposición rápida. */

import { getState } from '../core/state.js';
import { escapeHtml, money } from '../core/utils.js';

export function renderInventoryTable() {
    const state = getState();
    const tbody = document.getElementById('inventory-table-body');

    tbody.innerHTML = state.products.map(p => {
        const isLow = p.stock <= p.minStock;
        const isInternal = p.type === 'internal';
        const costOrPrice = isInternal
            ? `Costo: ${money(p.cost)}`
            : `Venta: <strong class="amount">${money(p.price)}</strong>`;

        return `
            <tr>
                <td class="cell-strong">${escapeHtml(p.name)}</td>
                <td>
                    <span class="badge ${isInternal ? 'badge--purple' : 'badge--retail'}">
                        ${isInternal ? 'Uso Interno (BOM)' : 'Venta Retail'}
                    </span>
                </td>
                <td class="cell-strong ${isLow ? 'stock-low' : ''}">${p.stock}</td>
                <td class="cell-muted">${escapeHtml(p.unit)}</td>
                <td class="cell-muted">${costOrPrice}</td>
                <td>
                    <span class="badge ${isLow ? 'badge--danger' : 'badge--success'}">
                        ${isLow ? 'Bajo Stock' : 'Normal'}
                    </span>
                </td>
                <td class="col-actions">
                    <button type="button" data-action="restock" data-id="${escapeHtml(p.id)}" class="btn btn--mini">
                        + Reponer
                    </button>
                </td>
            </tr>`;
    }).join('');
}
