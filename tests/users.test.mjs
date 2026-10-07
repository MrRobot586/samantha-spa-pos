import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createUser, updateUser, deleteUser } from '../js/domain/users.js';
import { createSeedState } from '../js/core/seed.js';
import { verifyPin } from '../js/core/pin.js';

test('createUser: username en minúsculas, PIN hasheado, activo y vinculado', () => {
    const state = createSeedState();
    const user = createUser(
        { name: '  Ana Pérez ', username: 'ANA ', role: 'stylist', pin: '4321', staffId: 'st1' },
        state
    );

    assert.equal(user.name, 'Ana Pérez');
    assert.equal(user.username, 'ana');
    assert.equal(user.role, 'stylist');
    assert.equal(user.active, true);
    assert.equal(user.staffId, 'st1');
    assert.ok(verifyPin('4321', user.salt, user.pinHash), 'el PIN verifica contra el hash');
    assert.ok(state.users.some(u => u.id === user.id));
});

test('createUser: el estilista sin staffId válido queda sin vincular y el admin nunca se vincula', () => {
    const state = createSeedState();
    const sinStaff = createUser({ name: 'Nueva', username: 'nueva', role: 'stylist', pin: '1234', staffId: 'no-existe' }, state);
    assert.equal(sinStaff.staffId, null);

    const admin = createUser({ name: 'Jefa', username: 'jefa', role: 'admin', pin: '1234', staffId: 'st1' }, state);
    assert.equal(admin.staffId, null, 'el admin no atribuye ventas');
});

test('createUser valida nombre, username, PIN y rol', () => {
    const state = createSeedState();
    const base = { name: 'X', username: 'x', role: 'stylist', pin: '1234' };

    assert.throws(() => createUser({ ...base, name: '   ' }, state), /nombre/);
    assert.throws(() => createUser({ ...base, username: '  ' }, state), /username/);
    assert.throws(() => createUser({ ...base, username: 'ADMIN' }, state), /en uso/);
    assert.throws(() => createUser({ ...base, pin: '123' }, state), /PIN/);
    assert.throws(() => createUser({ ...base, pin: '1234567' }, state), /PIN/);
    assert.throws(() => createUser({ ...base, pin: 'abcd' }, state), /PIN/);
    assert.throws(() => createUser({ ...base, pin: '' }, state), /PIN/, 'alta sin PIN → error');
    assert.throws(() => createUser({ ...base, role: 'superuser' }, state), /Rol/);
});

test('updateUser: cambia datos y PIN; PIN vacío conserva el anterior', () => {
    const state = createSeedState();
    const valeria = state.users.find(u => u.username === 'valeria');

    const actualizado = updateUser(valeria.id, {
        name: 'Valeria G.', username: 'Valeria', role: 'stylist',
        pin: '5555', staffId: 'st2', active: true
    }, state);

    assert.equal(actualizado.name, 'Valeria G.');
    assert.equal(actualizado.username, 'valeria');
    assert.equal(actualizado.staffId, 'st2');
    assert.ok(verifyPin('5555', actualizado.salt, actualizado.pinHash));
    assert.equal(verifyPin('1111', actualizado.salt, actualizado.pinHash), false, 'el PIN viejo ya no sirve');

    const sinPin = updateUser(actualizado.id, {
        name: 'Valeria G.', username: 'valeria', role: 'stylist',
        pin: '', staffId: null, active: true
    }, state);
    assert.ok(verifyPin('5555', sinPin.salt, sinPin.pinHash), 'PIN vacío → se conserva');
    assert.equal(sinPin.staffId, null, 'staffId sin vincular → null');
});

test('updateUser: username duplicado, id inexistente y datos inválidos', () => {
    const state = createSeedState();
    const carlos = state.users.find(u => u.username === 'carlos');
    const campos = { name: 'Carlos M.', username: 'carlos', role: 'stylist', pin: '', staffId: null, active: true };

    assert.throws(() => updateUser('no-existe', campos, state), /no encontrado/);
    assert.throws(() => updateUser(carlos.id, { ...campos, username: 'admin' }, state), /en uso/);
    assert.throws(() => updateUser(carlos.id, { ...campos, role: 'jefe' }, state), /Rol/);
    assert.throws(() => updateUser(carlos.id, { ...campos, pin: '99' }, state), /PIN/);
});

test('nunca se puede perder el último administrador activo', () => {
    const state = createSeedState();
    const admin = state.users.find(u => u.username === 'admin');
    const campos = { name: 'Administrador', username: 'admin', role: 'admin', pin: '', staffId: null, active: true };

    assert.throws(
        () => updateUser(admin.id, { ...campos, active: false }, state),
        /último administrador/,
        'no se puede desactivar al único admin'
    );
    assert.throws(
        () => updateUser(admin.id, { ...campos, role: 'stylist' }, state),
        /último administrador/,
        'no se puede degradar al único admin'
    );

    // Con un segundo admin activo sí se permite.
    createUser({ name: 'Segunda Jefa', username: 'segunda', role: 'admin', pin: '9999' }, state);
    const fuera = updateUser(admin.id, { ...campos, active: false }, state);
    assert.equal(fuera.active, false);
    assert.ok(state.users.find(u => u.username === 'segunda').active);
});

test('deleteUser elimina un usuario común', () => {
    const state = createSeedState();
    const borrado = deleteUser('u2', state);
    assert.equal(borrado.id, 'u2');
    assert.equal(state.users.some(u => u.id === 'u2'), false);
    assert.equal(state.users.length, 3);
});

test('deleteUser nunca borra el último administrador activo', () => {
    const state = createSeedState();
    assert.throws(() => deleteUser('u1', state), /último administrador/);
    assert.ok(state.users.some(u => u.id === 'u1'));
});

test('deleteUser permite borrar un admin si queda otro activo', () => {
    const state = createSeedState();
    createUser({ name: 'Segunda Jefa', username: 'jefa2', role: 'admin', pin: '9999' }, state);
    const borrado = deleteUser('u1', state);
    assert.equal(borrado.id, 'u1');
    assert.ok(state.users.some(u => u.role === 'admin' && u.active));
});

test('deleteUser devuelve null si el usuario no existe', () => {
    const state = createSeedState();
    assert.equal(deleteUser('no-existe', state), null);
});
