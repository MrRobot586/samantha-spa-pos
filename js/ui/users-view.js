/* Modal de gestión de usuarios (solo admin): lista + alta/edición en un
 * mismo formulario. El id oculto del formulario decide entre crear y
 * editar; el PIN queda en blanco al editar y significa "no cambiar". */

import { getState } from '../core/state.js';
import { getCurrentUser } from '../core/auth.js';
import { escapeHtml } from '../core/utils.js';

const byId = id => document.getElementById(id);

const roleLabel = role => (role === 'admin' ? 'Administrador' : 'Estilista');

export function renderUsersList() {
    const list = byId('users-list');
    if (!list) return;

    const sesion = getCurrentUser(getState());
    list.innerHTML = getState().users.map(u => `
        <div class="user-row${u.active ? '' : ' user-row--off'}">
            <div class="user-row__info">
                <p class="user-row__name">${escapeHtml(u.name)}${sesion && sesion.id === u.id ? ' <span class="badge badge--purple">Tú</span>' : ''}</p>
                <p class="user-row__meta">@${escapeHtml(u.username)} · ${roleLabel(u.role)}${u.active ? '' : ' · Desactivado'}</p>
            </div>
            <button type="button" class="btn btn--mini" data-action="edit-user" data-id="${escapeHtml(u.id)}">Editar</button>
        </div>`).join('');

    renderStaffOptions();
}

function renderStaffOptions() {
    const select = byId('user-staff');
    if (!select) return;
    select.innerHTML = '<option value="">— sin vincular —</option>' + getState().staff.map(s =>
        `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
}

/** Rellena el formulario con un usuario (modo edición). */
export function fillUserForm(userId) {
    const user = getState().users.find(u => u.id === userId);
    if (!user) return;

    byId('user-id').value = user.id;
    byId('user-name').value = user.name;
    byId('user-username').value = user.username;
    byId('user-role').value = user.role;
    byId('user-pin').value = '';
    byId('user-pin').placeholder = 'Deja vacío para no cambiar';
    byId('user-pin').required = false;
    byId('user-staff').value = user.staffId ?? '';
    byId('user-active').checked = user.active;
    byId('user-name').focus();
}

/** Deja el formulario listo para un alta. */
export function resetUserForm() {
    const form = byId('form-user');
    if (!form) return;
    form.reset();
    byId('user-id').value = '';
    byId('user-pin').placeholder = '4 a 6 dígitos';
    byId('user-pin').required = true;
    byId('user-active').checked = true;
}
