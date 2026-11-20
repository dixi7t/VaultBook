/* OfflineBooks US — company password protection (encryption at rest).
 *
 * Envelope encryption using the browser's built-in WebCrypto (no libraries):
 *   - A random 256-bit data key (DEK) encrypts every stored record with AES-GCM.
 *     Each record has its own random 96-bit IV; the store name and record id are bound
 *     as additional authenticated data, so records can't be swapped or altered unnoticed.
 *   - The DEK is wrapped (encrypted) twice:
 *       1) with a key derived from the company password  (PBKDF2-HMAC-SHA256, 600,000 iterations)
 *       2) with a key derived from a one-time recovery key (shown once when protection is turned on)
 *   - Changing the password only re-wraps the DEK; the data does not need re-encrypting.
 *   - A wrong password fails AES-GCM authentication when unwrapping, so no password hash is stored.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var C = OB.sec = {};
  var subtle = root.crypto && root.crypto.subtle;
  C.PBKDF2_ITERATIONS = 600000;
  C.RECOVERY_ITERATIONS = 100000; // recovery keys are 160-bit random, so fewer rounds are enough
  C.MIN_PASSWORD = 8;

  C.available = function () { return !!subtle && (root.isSecureContext !== false); };

  var enc = function (s) { return new TextEncoder().encode(s); };
  var dec = function (b) { return new TextDecoder().decode(b); };
  C.b64 = function (buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  C.unb64 = function (s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  function rand(n) { var a = new Uint8Array(n); root.crypto.getRandomValues(a); return a; }

  function kek(secret, salt, iterations) {
    return subtle.importKey('raw', enc(secret), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    });
  }
  C.newDataKey = function () { return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); };

  /** Wrap the data key with a secret. Returns a JSON-safe record. */
  C.wrap = function (dek, secret, iterations) {
    var salt = rand(16), iv = rand(12);
    iterations = iterations || C.PBKDF2_ITERATIONS;
    return kek(secret, salt, iterations).then(function (k) {
      return subtle.wrapKey('raw', dek, k, { name: 'AES-GCM', iv: iv });
    }).then(function (wrapped) {
      return { kdf: 'PBKDF2-SHA256', iterations: iterations, salt: C.b64(salt), iv: C.b64(iv), wrapped: C.b64(wrapped) };
    });
  };
  /** Unwrap; rejects with code 'BAD_SECRET' if the secret is wrong. */
  C.unwrap = function (rec, secret) {
    return kek(secret, C.unb64(rec.salt), rec.iterations).then(function (k) {
      return subtle.unwrapKey('raw', C.unb64(rec.wrapped), k, { name: 'AES-GCM', iv: C.unb64(rec.iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    }).catch(function () { var e = new Error('Incorrect password.'); e.code = 'BAD_SECRET'; throw e; });
  };

  /** Encrypt a JSON value. aad binds the ciphertext to its location (e.g. "transactions/txn_123"). */
  C.encryptJson = function (dek, value, aad) {
    var iv = rand(12);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc(aad || '') }, dek, enc(JSON.stringify(value)))
      .then(function (ct) { return { v: 1, iv: iv, ct: ct }; });
  };
  C.decryptJson = function (dek, rec, aad) {
    return subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: enc(aad || '') }, dek, rec.ct)
      .then(function (pt) { return JSON.parse(dec(pt)); })
      .catch(function () { throw new Error('A stored record could not be decrypted (wrong key or damaged data).'); });
  };

  /* ---------- recovery key: 160 random bits as 32 Crockford base32 characters ---------- */
  var ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  C.newRecoveryKey = function () {
    var bytes = rand(20), bits = 0, val = 0, out = '';
    for (var i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += ALPH[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    return out.match(/.{4}/g).join('-');
  };
  C.normalizeRecoveryKey = function (s) {
    var t = String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
    return (t.match(/.{1,4}/g) || []).join('-');
  };

  C.passwordProblems = function (pw, name) {
    var p = [];
    if (!pw || pw.length < C.MIN_PASSWORD) p.push('Use at least ' + C.MIN_PASSWORD + ' characters.');
    if (pw && name && pw.toLowerCase() === String(name).toLowerCase()) p.push("Don't use the company name.");
    if (pw && /^(.)\1+$/.test(pw)) p.push("Don't repeat one character.");
    if (pw && ['password', 'password1', '12345678', '123456789', 'qwertyui', 'letmein1', 'iloveyou'].indexOf(pw.toLowerCase()) >= 0) p.push('That password is too common.');
    return p;
  };
  /** Rough strength 0-4 for the meter. */
  C.strength = function (pw) {
    if (!pw) return 0;
    var classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(function (r) { return r.test(pw); }).length;
    var s = pw.length >= 16 ? 3 : pw.length >= 12 ? 2 : pw.length >= 8 ? 1 : 0;
    s += classes >= 3 ? 1 : 0;
    return Math.min(4, s);
  };

  /**
   * Build a new security record + data key from a password.
   * Returns { dek, security, recoveryKey }. security is stored unencrypted (it contains only wrapped keys).
   */
  C.setup = function (password, opts) {
    opts = opts || {};
    var recoveryKey = C.newRecoveryKey(), dek;
    return C.newDataKey().then(function (k) {
      dek = k;
      return Promise.all([C.wrap(dek, password), C.wrap(dek, C.normalizeRecoveryKey(recoveryKey), C.RECOVERY_ITERATIONS)]);
    }).then(function (w) {
      var security = { key: 'security', version: 1, cipher: 'AES-GCM-256', password: w[0], recovery: w[1], hint: opts.hint || '', autoLockMinutes: opts.autoLockMinutes === undefined ? 15 : +opts.autoLockMinutes, enabledAt: new Date().toISOString(), changedAt: new Date().toISOString() };
      return { dek: dek, security: security, recoveryKey: recoveryKey };
    });
  };
  /** Unlock with the password or (if mode === 'recovery') the recovery key. */
  C.unlock = function (security, secret, mode) {
    return mode === 'recovery' ? C.unwrap(security.recovery, C.normalizeRecoveryKey(secret)).catch(function (e) { e.message = 'That recovery key is not correct.'; throw e; })
      : C.unwrap(security.password, secret);
  };
})(typeof window !== 'undefined' ? window : globalThis);
