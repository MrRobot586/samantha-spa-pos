import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashPin, verifyPin } from '../js/core/pin.js';
import { can, login, logout, getCurrentUser } from '../js/core/auth.js';
import { createSeedState } from '../js/core/seed.js';
import { createMemoryBackend } from '../js/core/storage.js';
import { SESSION_KEY } from '../js/core/config.js';

test('hashPin es determinista, etiquetado y depende de salt y PIN', () => {
    const a = hashPin('1234', 'ss-admin');
    assert.equal(a, hashPin('1234', 'ss-admin'), 'misma entrada → mismo hash');
    assert.match(a, /^fnv1a:[0-9a-f]{16}$/);
    assert.notEqual(a, hashPin('1235', 'ss-admin'), 'PIN distinto → hash distinto');
    assert.notEqual(a, hashPin('1234', 'otra-salt'), 'salt distinta → hash distinto');
});

test('verifyPin acepta el PIN correcto y rechaza el resto', () => {
    const stored = hashPin('1234', 'ss-admin');
    assert.equal(verifyPin('1234', 'ss-admin', stored), true);
    assert.equal(verifyPin('1235', 'ss-admin', stored), false);
    assert.equal(verifyPin('1234', 'otra-salt', stored), false);
});

test('verifyPin no revienta con entradas malformadas', () => {
    const malos = [null, undefined, 42, {}, [], '', 'sin-etiqueta', 'md5:abc', 'fnv1a:corto'];
    for (const malo of malos) {
        assert.equal(verifyPin('1234', 's', malo), false, `stored=${String(malo)}`);
    }
    assert.equal(verifyPin(undefined, 's', hashPin('1234', 's')), false);
});

test('la semilla crea usuarios con PINs verificables', () => {
    const { users } = createSeedState();
    assert.equal(users.length, 4);
    assert.ok(users.every(u => typeof u.pinHash === 'string' && u.pinHash.startsWith('fnv1a:')));

    const admin = users.find(u => u.username === 'admin');
    assert.equal(admin.role, 'admin');
    assert.equal(verifyPin('1234', admin.salt, admin.pinHash), true);
    assert.equal(verifyPin('0000', admin.salt, admin.pinHash), false);

    const estilistas = users.filter(u => u.role === 'stylist');
    assert.equal(estilistas.length, 3);
    for (const s of estilistas) {
        assert.equal(verifyPin('1111', s.salt, s.pinHash), true);
    }
});

test('can(): el estilista solo ve dashboard y POS; el admin, todo', () => {
    assert.equal(can('admin', 'dashboard'), true);
    assert.equal(can('admin', 'pos'), true);
    assert.equal(can('admin', 'services'), true);
    assert.equal(can('admin', 'inventory'), true);
    assert.equal(can('admin', 'commissions'), true);
    assert.equal(can('admin', 'cash'), true);
    assert.equal(can('admin', 'users'), true);

    assert.equal(can('stylist', 'dashboard'), true);
    assert.equal(can('stylist', 'pos'), true);
    assert.equal(can('stylist', 'services'), false);
    assert.equal(can('stylist', 'inventory'), false);
    assert.equal(can('stylist', 'commissions'), false);
    assert.equal(can('stylist', 'cash'), false);
    assert.equal(can('stylist', 'users'), false);

    assert.equal(can(null, 'pos'), false, 'sin rol no hay permisos');
    assert.equal(can('admin', 'no-existe'), false);
});

test('login: PIN correcto crea sesión; los errores no dejan sesión', () => {
    const state = createSeedState();
    const backend = createMemoryBackend();

    const user = login('admin', '1234', state, backend);
    assert.equal(user.username, 'admin');
    assert.ok(backend.getItem(SESSION_KEY), 'la sesión queda escrita');
    assert.equal(getCurrentUser(state, backend).id, user.id);

    logout(backend);
    assert.equal(backend.getItem(SESSION_KEY), null, 'logout borra la sesión');

    assert.throws(() => login('admin', '9999', state, backend), /PIN incorrecto/);
    assert.throws(() => login('noexiste', '1234', state, backend), /no encontrado/);
    assert.equal(getCurrentUser(state, backend), null, 'login fallido = sin sesión');
});

test('login bloquea usuarios desactivados', () => {
    const state = createSeedState();
    const backend = createMemoryBackend();
    state.users.find(u => u.username === 'admin').active = false;

    assert.throws(() => login('admin', '1234', state, backend), /desactivado/);
    assert.equal(backend.getItem(SESSION_KEY), null);
});

test('getCurrentUser: sesión rota, usuario borrado o desactivado → null', () => {
    const state = createSeedState();
    const backend = createMemoryBackend();

    login('valeria', '1111', state, backend);
    assert.equal(getCurrentUser(state, backend).username, 'valeria');

    state.users = state.users.filter(u => u.username !== 'valeria');
    assert.equal(getCurrentUser(state, backend), null, 'usuario borrado → fuera');

    login('admin', '1234', state, backend);
    state.users.find(u => u.username === 'admin').active = false;
    assert.equal(getCurrentUser(state, backend), null, 'admin desactivado en caliente → fuera');

    const roto = createMemoryBackend({ [SESSION_KEY]: '{esto no es json' });
    assert.equal(getCurrentUser(state, roto), null, 'sesión corrupta → como sin sesión');
    assert.equal(getCurrentUser(state, null), null, 'sin backend → sin sesión');
});
