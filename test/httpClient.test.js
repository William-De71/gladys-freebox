import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { checkFreeboxIdentity, FREEBOX_TLS_OPTIONS } from '../src/freebox/httpClient.js';

test('the Freebox certificate chain is verified against both of Free root CAs', () => {
  assert.equal(FREEBOX_TLS_OPTIONS.rejectUnauthorized, true);
  const subjects = FREEBOX_TLS_OPTIONS.ca.map((pem) => new X509Certificate(pem).subject);
  assert.ok(subjects.some((subject) => subject.includes('CN=Freebox Root CA')));
  assert.ok(subjects.some((subject) => subject.includes('CN=Freebox ECC Root CA')));
});

test('a certificate naming mafreebox.freebox.fr is accepted', () => {
  const cert = {
    subject: { CN: 'abcd1234.fbxos.fr' },
    subjectaltname: 'DNS:abcd1234.fbxos.fr, DNS:mafreebox.freebox.fr',
  };
  assert.equal(checkFreeboxIdentity('mafreebox.freebox.fr', cert), undefined);
});

test('a certificate naming only the box fbxos.fr domain is accepted', () => {
  const cert = { subject: { CN: 'abcd1234.fbxos.fr' }, subjectaltname: 'DNS:abcd1234.fbxos.fr' };
  assert.equal(checkFreeboxIdentity('mafreebox.freebox.fr', cert), undefined);
});

test('a certificate naming another host is refused', () => {
  const cert = { subject: { CN: 'nas.example.com' }, subjectaltname: 'DNS:nas.example.com' };
  assert.ok(checkFreeboxIdentity('mafreebox.freebox.fr', cert) instanceof Error);
});

test('a look-alike of the fbxos.fr domain is refused', () => {
  const cert = {
    subject: { CN: 'box.fbxos.fr.evil.com' },
    subjectaltname: 'DNS:box.fbxos.fr.evil.com',
  };
  assert.ok(checkFreeboxIdentity('mafreebox.freebox.fr', cert) instanceof Error);
});
