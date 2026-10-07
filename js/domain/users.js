/* Gestión de usuarios (solo admin): alta, edición, alta/baja y cambio de
 * PIN. El PIN se guarda hasheado con salt (core/pin.js) y nunca vuelve a
 * leerse: si está vacío al editar, se conserva el que ya tenía. */

import { getState } from '../core/state.js';
import { getCurrentUser } from '../core/auth.js';
import { hashPin } from '../core/pin.js';
import { uid } from '../core/utils.js';

const PIN_PATTERN = /^\d{4,6}$/;
const isValidRole = r => r === 'admin' || r === 'stylist';

const cleanUsername = v => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Valida nombre/username/rol; devuelve el PIN nuevo o null si no hay. */
function validateBase(data, requirePin) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) throw new Error('El nombre del usuario no puede estar vacío.');

    const username = cleanUsername(data.username);
    if (!username) throw new Error('El username no puede estar vacío.');

    if (!isValidRole(data.role)) throw new Error('Rol no válido: usa "admin" o "stylist".');

    const sinPin = data.pin === '' || data.pin === undefined || data.pin === null;
    if (sinPin) {
        if (requirePin) throw new Error('El PIN debe tener de 4 a 6 dígitos.');
    } else if (!PIN_PATTERN.test(String(data.pin))) {
        throw new Error('El PIN debe tener de 4 a 6 dígitos.');
    }

    return { name, username, pin: sinPin ? null : String(data.pin) };
}

function assertUsernameFree(state, username, exceptId = null) {
    if (state.users.some(u => u.username === username && u.id !== exceptId)) {
        throw new Error(`El username "${username}" ya está en uso.`);
    }
}

function linkStaff(state, role, staffId) {
    if (role !== 'stylist') return null;
    return state.staff.some(s => s.id === staffId) ? staffId : null;
}

/** Alta de usuario. Lanza Error con mensaje en español si algo no cuadra. */
export function createUser(data, state = getState()) {
    const { name, username, pin } = validateBase(data, true);
    assertUsernameFree(state, username);

    const salt = uid();
    const user = {
        id: uid(),
        name,
        username,
        role: data.role,
        pinHash: hashPin(pin, salt),
        salt,
        active: true,
        staffId: linkStaff(state, data.role, data.staffId)
    };
    state.users.push(user);
    return user;
}

/**
 * Edición de usuario. `pin` vacío = no cambiar. Nunca se permite quedar
 * sin al menos un administrador activo (desactivar o degradar al último
 * lanzaría Error: sin admin no hay quien gestione los usuarios).
 */
export function updateUser(id, data, state = getState()) {
    const user = state.users.find(u => u.id === id);
    if (!user) throw new Error('Usuario no encontrado.');

    const { name, username, pin } = validateBase(data, false);
    assertUsernameFree(state, username, id);

    const role = data.role;
    const active = typeof data.active === 'boolean' ? data.active : user.active;

    const pierdeAdmin = user.role === 'admin' && (role !== 'admin' || !active);
    if (pierdeAdmin) {
        const otrosAdmines = state.users.filter(u => u.id !== id && u.role === 'admin' && u.active);
        if (otrosAdmines.length === 0) {
            throw new Error('No se puede quitar el último administrador activo.');
        }
    }

    user.name = name;
    user.username = username;
    user.role = role;
    user.active = active;
    user.staffId = linkStaff(state, role, data.staffId);

    if (pin !== null) {
        user.salt = uid();
        user.pinHash = hashPin(pin, user.salt);
    }
    return user;
}

/**
 * Baja definitiva de un usuario. Nunca se borra el último administrador
 * activo ni la cuenta con la que se opera ahora mismo (habría que
 * desloguearse a uno mismo para poder borrarse).
 * @returns el usuario eliminado (null si ya no existía)
 */
export function deleteUser(id, state = getState()) {
    const user = state.users.find(u => u.id === id);
    if (!user) return null;

    if (id === getCurrentUser(state)?.id) {
        throw new Error('No puedes eliminar tu propia cuenta de usuario.');
    }

    if (user.role === 'admin' && user.active) {
        const otrosAdmines = state.users.filter(u => u.id !== id && u.role === 'admin' && u.active);
        if (otrosAdmines.length === 0) {
            throw new Error('No se puede eliminar el último administrador activo.');
        }
    }

    state.users = state.users.filter(u => u.id !== id);
    return user;
}
