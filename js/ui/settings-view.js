/* Pestaña Configuración (solo admin): métodos de pago, comisión del rol,
 * ticket de canje y datos. Los métodos viven en settings.paymentMethods
 * ({ id, label, icon, type }) y alimentan al POS, la caja y los reportes
 * junto con los de fábrica (ver domain/payments.js). */

import { getState } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { activePaymentMethods } from '../domain/payments.js';

const TYPE_LABELS = { fisico: 'Físico', electronico: 'Electrónico' };
const DEFAULT_ICONS = ['fa-money-bill-transfer', 'fa-mobile-screen', 'fa-wallet', 'fa-receipt', 'fa-cash-register'];

let nextIcon = 0;

function yaciendoMetodo(id) {
    return getState().settings.paymentMethods?.some(m => m.id === id) ?? false;
}

/** Id estable derivado del nombre (solo se calcula al crear; al editar no
 *  cambia para conservar el vínculo con ventas históricas). */
function slugId(label) {
    const base = label.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return base || 'metodo';
}

export function renderSettings() {
    renderPaymentMethods();
    renderCommission();
    renderPrintSettings();
}

export function renderPaymentMethods() {
    const list = document.getElementById('payment-methods-list');
    const methods = activePaymentMethods(getState());
    const rows = methods.map(m => {
        const esFijo = m.id === 'cash';
        const acciones = esFijo
            ? '<span class="cell-muted">Fijo</span>'
            : `<button type="button" data-action="edit-method" data-id="${m.id}" class="btn btn--neutral btn--sm">Editar</button>
               <button type="button" data-action="delete-method" data-id="${m.id}" class="btn btn--danger btn--ghost btn--sm">Eliminar</button>`;
        return `<tr>
            <td data-label="Método"><i class="fa-solid ${escapeHtml(m.icon || 'fa-credit-card')}"></i> ${escapeHtml(m.label)}</td>
            <td data-label="Tipo" class="cell-muted">${escapeHtml(TYPE_LABELS[m.type] || m.type)}</td>
            <td class="cell-right">${acciones}</td>
        </tr>`;
    }).join('');
    list.innerHTML = rows
        || '<tr><td colspan="3" class="empty-cell">Sin métodos de pago.</td></tr>';
}

export function renderCommission() {
    const st = getState().settings;
    document.getElementById('commission-rate').value = String(st.stylistCommissionRate ?? 45);
}

export function renderPrintSettings() {
    const t = getState().settings.ticket;
    document.getElementById('ticket-width').value = String(t.printerWidth);
    document.getElementById('ticket-business-name').value = t.businessName;
    document.getElementById('ticket-business-line').value = t.businessLine;
    document.getElementById('ticket-footer').value = t.footer;
    document.getElementById('ticket-show-prices').checked = t.showPrices;
}

export function resetMethodForm() {
    document.getElementById('method-id').value = '';
    document.getElementById('method-label').value = '';
    document.getElementById('method-type').value = 'fisico';
    document.getElementById('btn-method-save').textContent = 'Agregar método';
    document.getElementById('btn-method-cancel').classList.add('is-hidden');
}

export function fillMethodForm(id) {
    const m = activePaymentMethods(getState()).find(x => x.id === id);
    if (!m) throw new Error('Método no encontrado.');
    if (m.id === 'cash') throw new Error('El efectivo es fijo y no admite cambios.');
    document.getElementById('method-id').value = m.id;
    document.getElementById('method-label').value = m.label;
    document.getElementById('method-type').value = m.type;
    document.getElementById('btn-method-save').textContent = 'Guardar cambios';
    document.getElementById('btn-method-cancel').classList.remove('is-hidden');
    document.getElementById('method-label').focus();
}

/** Crea o edita un método. Devuelve {added, label} para el toast. */
export function saveMethod() {
    const state = getState();
    const id = document.getElementById('method-id').value;
    const label = document.getElementById('method-label').value.trim().slice(0, 24);
    const type = document.getElementById('method-type').value === 'electronico' ? 'electronico' : 'fisico';

    if (!label) throw new Error('Escribe un nombre para el método.');
    if (!Array.isArray(state.settings.paymentMethods)) state.settings.paymentMethods = [];

    if (id) {
        const m = state.settings.paymentMethods.find(x => x.id === id);
        if (!m) throw new Error('Método no encontrado.');
        m.label = label;
        m.type = type;
        resetMethodForm();
        return { added: false, label };
    }

    const newId = slugId(label);
    if (yaciendoMetodo(newId)) throw new Error(`Ya existe el método "${label}".`);
    state.settings.paymentMethods.push({
        id: newId,
        label,
        icon: DEFAULT_ICONS[(nextIcon++) % DEFAULT_ICONS.length],
        type
    });
    resetMethodForm();
    return { added: true, label };
}

export function deleteMethod(id) {
    const state = getState();
    if (id === 'cash') throw new Error('El efectivo es el método de respaldo y no se puede borrar.');
    const list = state.settings.paymentMethods || [];
    const m = list.find(x => x.id === id);
    if (!m) throw new Error('Método no encontrado.');
    state.settings.paymentMethods = list.filter(x => x.id !== id);
    return m;
}