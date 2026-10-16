// The browser half of passkeys. The server speaks JSON with base64url strings, and the WebAuthn API wants buffers.
// This file is read by the sign-in page as well as the app, so it imports nothing.
const toBuffer = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer;
const toText = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const IP_ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

// An RP ID has to be a domain name, so an IP address cannot have passkeys, and the API exists only on https pages and localhost.
export function passkeySupport() {
  if (IP_ADDRESS.test(location.hostname)) return { ok: false, why: 'Passkeys do not work on an IP address. Use localhost or a name.' };
  if (!window.isSecureContext) return { ok: false, why: 'Passkeys need https, or the address localhost.' };
  if (!window.PublicKeyCredential || !navigator.credentials) return { ok: false, why: 'This browser cannot use passkeys.' };
  return { ok: true, why: '' };
}

export async function makePasskey(options) {
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: toBuffer(options.challenge),
      user: { ...options.user, id: toBuffer(options.user.id) },
      excludeCredentials: options.excludeCredentials.map(c => ({ ...c, id: toBuffer(c.id) })),
    },
  });
  const { clientDataJSON, attestationObject } = credential.response;
  return { id: credential.id, response: { clientDataJSON: toText(clientDataJSON), attestationObject: toText(attestationObject) } };
}

// With `conditional`, the request waits quietly until the person picks a passkey from the password field's autofill list.
export async function usePasskey(options, { conditional = false, signal } = {}) {
  const credential = await navigator.credentials.get({
    mediation: conditional ? 'conditional' : undefined,
    signal,
    publicKey: { ...options, challenge: toBuffer(options.challenge), allowCredentials: [] },
  });
  const { clientDataJSON, authenticatorData, signature, userHandle } = credential.response;
  return {
    id: credential.id,
    response: { clientDataJSON: toText(clientDataJSON), authenticatorData: toText(authenticatorData), signature: toText(signature), userHandle: userHandle ? toText(userHandle) : null },
  };
}

// An empty string means the person backed out, which needs no message.
export function describeFailure(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return '';
  if (e?.name === 'InvalidStateError') return 'This device already has a passkey for Capcom.';
  if (e?.name === 'SecurityError') return 'This address cannot use passkeys.';
  if (e?.name === 'NotSupportedError') return 'This device cannot make a passkey Capcom accepts.';
  if (e instanceof TypeError) return 'Could not reach Capcom.';
  return e?.message || 'The passkey did not work.';
}
