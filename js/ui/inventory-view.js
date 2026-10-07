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
                    <div class="row-actions">
                        <button type="button" data-action="edit-product" data-id="${escapeHtml(p.id)}" class="btn btn--mini">
                            Editar
                        </button>
                        <button type="button" data-action="restock" data-id="${escapeHtml(p.id)}" class="btn btn--mini">
                            + Reponer
                        </button>
                        <button type="button" data-action="delete-product" data-id="${escapeHtml(p.id)}"
                                data-title="¿Eliminar producto?"
                                data-message="Se eliminará &quot;${escapeHtml(p.name)}&quot; del inventario. Si algún servicio lo usa como insumo, no se podrá borrar."
                                class="btn btn--mini btn--mini-danger">Eliminar</button>
                    </div>
                </td>
            </tr>`;
    }).join('');
}

/** Rellena el modal de producto para editar; vacío para crear. */
export function fillProductForm(id = '') {
    const state = getState();
    const form = document.getElementById('form-add-product');
    form.reset();
    document.getElementById('product-id').value = '';

    const title = document.getElementById('modal-product-title');
    if (!id) {
        title.textContent = 'Nuevo Producto / Insumo';
        return;
    }

    const p = state.products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('product-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-type').value = p.type;
    document.getElementById('prod-unit').value = p.unit;
    document.getElementById('prod-stock').value = p.stock;
    document.getElementById('prod-min').value = p.minStock;
    document.getElementById('prod-cost').value = p.cost;
    document.getElementById('prod-price').value = p.price;
    title.textContent = 'Editar Producto / Insumo';
}
