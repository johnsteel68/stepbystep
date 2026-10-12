import assert from 'node:assert/strict';
import test from 'node:test';
import { describeInvalidDeckResponse, getDeckUploadEndpoint, uploadStepToDeck } from '../deckUpload.ts';

const step = () => new File(['ISO-10303-21;'], 'part.step', { type: 'application/step' });
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('upload preserves the multipart contract and never follows shop redirects', async () => {
  const url = await uploadStepToDeck(step(), async (endpoint, options) => {
    assert.equal(endpoint, getDeckUploadEndpoint());
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.method, 'POST');
    const file = (options!.body as FormData).get('file') as File;
    assert.equal(file.name, 'part.step');
    assert.equal(await file.text(), 'ISO-10303-21;');
    return new Response(JSON.stringify({ success: true, deck_url: '/fr/module/johnsteel_deck/deck?ids_analysis[0]=123' }));
  });
  assert.equal(new URL(url).hostname, 'www.john-steel.com');
  assert.equal(new URL(url).searchParams.get('ids_analysis[0]'), '123');
});

test('200 HTML and malformed JSON cannot masquerade as successful uploads', async () => {
  await assert.rejects(uploadStepToDeck(step(), async () => new Response('<html>shop</html>', { headers: { 'content-type': 'text/html' } })), /Réponse non JSON/);
  for (const value of [null, [], 'success', { success: false }, { success: true }]) {
    await assert.rejects(uploadStepToDeck(step(), reply(value)));
  }
});

test('server errors retain the useful shop message', async () => {
  await assert.rejects(uploadStepToDeck(step(), reply({ message: 'Format refusé' }, 422)), /Format refusé/);
});

test('deck destinations must belong to the trusted HTTPS shop', async () => {
  for (const url of ['http://www.john-steel.com/deck', 'https://example.com/deck', 'https://www.john-steel.com.evil.example/deck', 'https://user:secret@www.john-steel.com/deck', 'https://www.john-steel.com:8443/deck']) {
    await assert.rejects(uploadStepToDeck(step(), reply({ success: true, deck_url: url })), /inattendue/);
  }
});

test('sends STEP files directly to the uploader instead of the redirecting relay', () => {
  assert.equal(
    getDeckUploadEndpoint(),
    'https://www.john-steel.com/fr/module/johnsteel_uploader/upload',
  );
});

test('describes non-JSON deck responses without exposing URL query data', () => {
  assert.equal(
    describeInvalidDeckResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      url: 'https://www.john-steel.com/fr/connexion?token=private',
      redirected: true,
      bodyLength: 812,
    }),
    'Réponse non JSON du service du deck (HTTP 200, text/html; redirection finale : www.john-steel.com/fr/connexion; corps 812 caractères).',
  );
});
