/* Autenticación local: usuarios + PIN con roles.
 *
 * Al no haber backend, la sesión vive en localStorage (clave aparte del
 * estado del negocio) y sobrevive a F5. Esto es control de acceso en el
 * equipo —quién hizo qué venta—, no seguridad de servidor: el PIN viaja
 * hasheado con salt (ver core/pin.js), pero alguien con acceso al equipo
 * podría editar el localStorage. Lo dice el README con todas las letras. */

import { SESSION_KEY } from './config.js';
import { verifyPin } from './pin.js';
import { getState } from './state.js';
import { defaultBackend } from './storage.js';

/** Qué puede ver cada rol. Las pestañas y utilidades se ocultan con esto. */
const PERMISSIONS = {
    dashboard: ['admin', 'stylist'],
    pos: ['admin', 'stylist'],
    services: ['admin'],
    inventory: ['admin'],
    commissions: ['admin'],
    cash: ['admin'],
    users: ['admin']
};

export function can(role, permission) {
    return Array.isArray(PERMISSIONS[permission]) && PERMISSIONS[permission].includes(role);
}

function readSession(backend) {
    if (!backend) return null;
    try {
        const raw = backend.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.userId !== 'string') {
            return null;
        }
        return { userId: parsed.userId };
    } catch {
        return null; // sesión corrupta → como si no hubiera sesión
    }
}

function writeSession(backend, userId) {
    if (!backend) return;
    try {
        backend.setItem(SESSION_KEY, JSON.stringify({ userId, loginAt: new Date().toISOString() }));
    } catch {
        // Sin espacio: la sesión durará solo hasta recargar; no es un error bloqueante.
    }
}

/** Cierra la sesión (borra la clave, el resto de datos queda intacto). */
export function logout(backend = defaultBackend()) {
    if (!backend) return;
    try {
        backend.removeItem(SESSION_KEY);
    } catch {
        // no hay nada que limpiar de verdad si el backend falla
    }
}

/**
 * Valida credenciales y crea la sesión. Lanza Error con mensaje en español
 * (el llamador lo pinta en la pantalla de login).
 */
export function login(username, pin, state = getState(), backend = defaultBackend()) {
    const name = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const user = state.users.find(u => u.username === name);

    if (!user) throw new Error('Usuario no encontrado.');
    if (!user.active) throw new Error('Usuario desactivado: pide al administrador reactivarlo.');
    if (!verifyPin(String(pin ?? ''), user.salt, user.pinHash)) throw new Error('PIN incorrecto.');

    writeSession(backend, user.id);
    return user;
}

/** Usuario de la sesión actual, o null si no hay sesión o ya no es válido
 *  (borrado o desactivado mientras estaba logueado). */
export function getCurrentUser(state = getState(), backend = defaultBackend()) {
    const session = readSession(backend);
    if (!session) return null;
    return state.users.find(u => u.id === session.userId && u.active) ?? null;
}
