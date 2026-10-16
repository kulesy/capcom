// The sign-in page's passkey button, and the passkeys offered in the password field's autofill list.
import { describeFailure, passkeySupport, usePasskey } from './ui/webauthn.js';

const button = document.getElementById('passkey');
const hint = document.getElementById('passkey-hint');
const notice = document.getElementById('notice');
const AUTOFILL_MS = 4 * 60_000;

let autofill = null;
let renewal = 0;

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function ask() {
  const r = await post('passkey-options', { origin: location.origin });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Passkeys are not available right now.');
  return data;
}

function say(text) {
  hint.textContent = text;
  hint.hidden = !text;
}

async function finish(answer) {
  const r = await post('passkey-login', answer);
  if (r.ok) return location.replace('./');
  const data = await r.json().catch(() => ({}));
  throw new Error(data.error || 'That passkey did not work.');
}

function stopListening() {
  clearTimeout(renewal);
  autofill?.abort();
  autofill = null;
}

// The server forgets a challenge after five minutes, so the autofill request is started over before that.
async function listen() {
  stopListening();
  const mine = autofill = new AbortController();
  renewal = setTimeout(listen, AUTOFILL_MS);
  let reply;
  try {
    reply = await ask();
  } catch (e) {
    if (autofill === mine) { stopListening(); say(e.message); }
    return;
  }
  if (autofill !== mine) return;
  button.hidden = !reply.options;
  if (!reply.options) {
    stopListening();
    say(reply.why || '');
    return;
  }
  if (!await PublicKeyCredential.isConditionalMediationAvailable?.()) return;
  let answer;
  try {
    answer = await usePasskey(reply.options, { conditional: true, signal: mine.signal });
  } catch (e) {
    if (autofill === mine) { stopListening(); notice.textContent = describeFailure(e); }
    return;
  }
  try {
    await finish(answer);
  } catch (e) {
    notice.textContent = e.message;
    listen();
  }
}

button.addEventListener('click', async () => {
  stopListening();
  button.disabled = true;
  notice.textContent = '';
  try {
    const { options } = await ask();
    if (!options) throw new Error('No passkeys are added for this address.');
    await finish(await usePasskey(options));
  } catch (e) {
    notice.textContent = describeFailure(e);
    button.disabled = false;
    listen();
  }
});

const support = passkeySupport();
if (support.ok) listen();
else say(support.why);
