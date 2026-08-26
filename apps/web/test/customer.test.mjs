import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';

import {
  IDENTITY_PRESENTATION,
  MAX_PHOTO_BYTES,
  ageOn,
  birthDateRejection,
  formatDocument,
  outcomeFromAudit,
  photoRejection,
  usernameFrom,
  updatePayload,
  validateRegistration,
  validateUpdate,
} from '../app/lib/customer.ts';

// The registration rules are the frontend logic of T-16 that actually decides
// something, so they live in a plain module and are asserted here rather than
// inside a component TD-010 would leave unverifiable.

const TODAY = new Date(2026, 7, 26); // 2026-08-26, the date this suite was written for.

describe('the username a name produces', () => {
  test('an accented name loses its accents, never its letters', () => {
    assert.equal(usernameFrom('María Fernanda López García'), 'mlopez');
  });

  test('two words are a given name and a surname', () => {
    assert.equal(usernameFrom('Ana Ramírez'), 'aramirez');
  });

  test('a single word still produces something typable', () => {
    assert.equal(usernameFrom('Madonna'), 'madonna');
  });

  test('punctuation and double spaces do not survive', () => {
    assert.equal(usernameFrom('  José  Pérez-Ruiz '), 'jperezruiz');
  });

  test('an empty name produces nothing rather than a stray letter', () => {
    assert.equal(usernameFrom('   '), '');
  });

  test('it never exceeds the column it previews', () => {
    assert.ok(usernameFrom(`Ana ${'r'.repeat(200)}`).length <= 60);
  });
});

describe('the birth date', () => {
  test('an impossible calendar date is refused instead of rolling over', () => {
    // `new Date('2026-02-31')` is the 3rd of March; accepting it would store a
    // different day than the one that was typed.
    assert.match(birthDateRejection('1996-02-31', TODAY), /fecha válida/);
  });

  test('a future date is refused', () => {
    assert.match(birthDateRejection('2027-01-01', TODAY), /futuro/);
  });

  test('a minor is refused, and the message says why', () => {
    assert.match(birthDateRejection('2015-04-18', TODAY), /18 años/);
  });

  test('an adult passes', () => {
    assert.equal(birthDateRejection('1996-04-18', TODAY), null);
  });

  test('the age does not count a birthday that has not arrived', () => {
    assert.equal(ageOn('1996-12-31', TODAY), 29);
    assert.equal(ageOn('1996-01-01', TODAY), 30);
  });
});

describe('the identity photo, refused locally', () => {
  test('no file at all is a rejection with its own message', () => {
    assert.match(photoRejection(null), /Adjunta/);
  });

  test('a PDF is refused by type', () => {
    assert.match(photoRejection({ type: 'application/pdf', size: 1000 }), /JPG o PNG/);
  });

  test('one byte over five megabytes is over the limit', () => {
    const rejection = photoRejection({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 });

    assert.match(rejection, /máximo es 5 MB/);
  });

  test('exactly five megabytes is accepted, as the Gateway accepts it', () => {
    assert.equal(photoRejection({ type: 'image/jpeg', size: MAX_PHOTO_BYTES }), null);
  });
});

describe('the registration form, checked without a request', () => {
  const VALID = {
    fullName: 'María Fernanda López García',
    identityDocument: '2547 89632 0101',
    email: 'maria.lopez@correo.com',
    dateOfBirth: '1996-04-18',
    address: '12 calle 3-45 zona 1, Guatemala',
    credential: 'unaClaveLarga',
    credentialConfirmation: 'unaClaveLarga',
    terms: true,
  };

  test('a complete form has nothing to say', () => {
    assert.deepEqual(validateRegistration(VALID, TODAY), {});
  });

  test('every problem is reported at once, not one per attempt', () => {
    const errors = validateRegistration(
      {
        ...VALID,
        fullName: '',
        email: 'no-es-un-correo',
        identityDocument: '123',
        credential: 'corta',
        credentialConfirmation: 'otra',
        terms: false,
      },
      TODAY,
    );

    assert.deepEqual(Object.keys(errors).sort(), [
      'credential',
      'credentialConfirmation',
      'email',
      'fullName',
      'identityDocument',
      'terms',
    ]);
  });

  test('a single word is not a full name, because no username comes out of it', () => {
    const errors = validateRegistration({ ...VALID, fullName: 'Madonna' }, TODAY);

    assert.match(errors.fullName, /nombre y un apellido/);
  });

  test('the DPI is thirteen digits, spaces or not', () => {
    assert.equal(validateRegistration({ ...VALID, identityDocument: '2547896320101' }, TODAY).identityDocument, undefined);
    assert.match(validateRegistration({ ...VALID, identityDocument: '25478963201' }, TODAY).identityDocument, /13 dígitos/);
  });

  test('mismatched passwords are caught before the request', () => {
    const errors = validateRegistration({ ...VALID, credentialConfirmation: 'otraClave' }, TODAY);

    assert.match(errors.credentialConfirmation, /no coinciden/);
  });
});

describe('the update form, with nothing to prefill it', () => {
  // There is no GET /api/customers/:id in the Gateway, so an empty box means
  // "leave this alone" rather than "erase it".
  test('an empty form is refused before it is sent, as the contract refuses it', () => {
    assert.match(validateUpdate({}, TODAY).form, /al menos un dato/);
  });

  test('one filled field is enough', () => {
    assert.deepEqual(validateUpdate({ address: 'Otra dirección' }, TODAY), {});
  });

  test('a field that was filled is still checked', () => {
    assert.match(validateUpdate({ dateOfBirth: '2027-01-01' }, TODAY).dateOfBirth, /futuro/);
  });

  test('only the filled fields travel, trimmed', () => {
    assert.deepEqual(
      updatePayload({ fullName: '  Ana Ramírez  ', address: '', dateOfBirth: '' }),
      { fullName: 'Ana Ramírez' },
    );
  });

  test('whitespace alone is not a change', () => {
    assert.deepEqual(updatePayload({ address: '   ' }), {});
  });
});

describe('reading the audit trail', () => {
  test('the registration event is the success', () => {
    assert.equal(
      outcomeFromAudit([
        { messageType: 'customer.register.v1' },
        { messageType: 'customer.registered.v1' },
      ]),
      'SUCCESS',
    );
  });

  test('a rejected identity is a business rejection', () => {
    assert.equal(
      outcomeFromAudit([{ messageType: 'customer.identity.rejected.v1' }]),
      'BUSINESS_REJECTION',
    );
  });

  test('the command alone is not an outcome — the wait continues', () => {
    // This is what a duplicated document produces today: the catalogue has no
    // registration-rejected event, so the trail stays silent and the screen
    // must time out rather than invent a verdict.
    assert.equal(outcomeFromAudit([{ messageType: 'customer.register.v1' }]), null);
  });

  test('an empty trail is not a failure', () => {
    assert.equal(outcomeFromAudit([]), null);
  });
});

describe('how things are written for a person', () => {
  test('the three identity states each have a colour and an explanation', () => {
    for (const status of ['PENDING', 'VALIDATED', 'REJECTED']) {
      assert.ok(IDENTITY_PRESENTATION[status].label.length > 0);
      assert.ok(IDENTITY_PRESENTATION[status].explanation.length > 0);
    }

    assert.equal(IDENTITY_PRESENTATION.PENDING.color, 'warning');
    assert.equal(IDENTITY_PRESENTATION.VALIDATED.color, 'success');
    assert.equal(IDENTITY_PRESENTATION.REJECTED.color, 'error');
  });

  test('a DPI is grouped the way the prototype prints it', () => {
    assert.equal(formatDocument('2547896320101'), '2547 89632 0101');
  });

  test('anything that is not a DPI is left alone', () => {
    assert.equal(formatDocument('AB-123'), 'AB-123');
  });
});
