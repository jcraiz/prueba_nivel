/**
 * JCAH_TGenX — Cryptographic & Security Service (Shared Implementation)
 * Canonical implementation used by both author studio and runtime.
 * Implements Web Crypto API (AES-GCM 256-bit + PBKDF2) for:
 * 1. Password-Protected Offline Report Encryption & Decryption (.jcah)
 * 2. Code-Inspection Anti-Cheating (Salted SHA-256 Answer Key Obfuscation)
 * 3. Secure Key Derivation and Random Passwords
 *
 * NOTE: Dead verification methods (verifyObfuscatedAnswer/verifyAnswerMatch)
 * were removed in v10.0; scoring is computed synchronously via shared/scoring.js (sha256Sync).
 */
const JCAHCrypto = (() => {

  const REPORT_MAGIC = 'JCAH_TGENX_ENCRYPTED_REPORT';
  const PBKDF2_ITERATIONS = 100000;

  // -------------------------------------------------------------------------
  // ArrayBuffer <-> Base64 Helpers
  // -------------------------------------------------------------------------
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return (typeof window !== 'undefined' && window.btoa)
      ? window.btoa(binary)
      : Buffer.from(binary, 'binary').toString('base64');
  }

  function base64ToBuffer(base64) {
    const binary = (typeof window !== 'undefined' && window.atob)
      ? window.atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function stringToBuffer(str) {
    return new TextEncoder().encode(str);
  }

  function bufferToString(buffer) {
    return new TextDecoder().decode(buffer);
  }

  function getSubtleCrypto() {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) return window.crypto.subtle;
    try {
      const nodeCrypto = require('crypto');
      if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) return nodeCrypto.webcrypto.subtle;
    } catch (_) {}
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
  }

  function getRandomValues(arr) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) return crypto.getRandomValues(arr);
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) return window.crypto.getRandomValues(arr);
    try {
      const nodeCrypto = require('crypto');
      if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.getRandomValues) return nodeCrypto.webcrypto.getRandomValues(arr);
    } catch (_) {}
    throw new Error('Web Crypto getRandomValues is not available.');
  }

  // -------------------------------------------------------------------------
  // PBKDF2 Key Derivation
  // -------------------------------------------------------------------------
  async function deriveKey(password, saltBuffer, usage = ['encrypt', 'decrypt']) {
    const subtle = getSubtleCrypto();
    const passwordKey = await subtle.importKey(
      'raw',
      stringToBuffer(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usage
    );
  }

  // -------------------------------------------------------------------------
  // 1. Password-Protected Offline Report: Encrypt
  // -------------------------------------------------------------------------
  /**
   * Encrypt candidate exam report object into an encrypted container
   * @param {object} reportPayload - candidate answers, scores, timestamps, photos
   * @param {string} password - author master password
   * @returns {Promise<string>} JSON string of the encrypted report
   */
  async function encryptReport(reportPayload, password) {
    if (!password || !password.trim()) {
      throw new Error('La contraseña de cifrado del reporte es obligatoria.');
    }

    const subtle = getSubtleCrypto();
    const salt = getRandomValues(new Uint8Array(16));
    const iv = getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password.trim(), salt, ['encrypt']);

    const rawData = JSON.stringify(reportPayload);
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      stringToBuffer(rawData)
    );

    const container = {
      magic: REPORT_MAGIC,
      version: 1,
      createdAt: new Date().toISOString(),
      studentId: reportPayload.studentId || 'N/A',
      studentName: reportPayload.studentName || 'N/A',
      examTitle: reportPayload.examTitle || 'JCAH Exam',
      examId: reportPayload.examId || '',
      salt: bufferToBase64(salt),
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(encrypted),
      checksum: await computeSHA256(rawData),
    };

    return JSON.stringify(container, null, 2);
  }

  // -------------------------------------------------------------------------
  // 2. Password-Protected Offline Report: Decrypt
  // -------------------------------------------------------------------------
  /**
   * Decrypt candidate exam report container
   * @param {string|object} encryptedContainer
   * @param {string} password - author master password
   * @returns {Promise<object>} decrypted report object
   */
  async function decryptReport(encryptedContainer, password) {
    let parsed = encryptedContainer;
    if (typeof encryptedContainer === 'string') {
      try {
        parsed = JSON.parse(encryptedContainer);
      } catch (e) {
        throw new Error('El archivo no tiene un formato JSON válido.');
      }
    }

    // Direct JSON backup report (unencrypted)
    if (parsed && (parsed.scores || parsed.answers) && (parsed.studentId || parsed.studentName) && !parsed.ciphertext) {
      console.log('[JCAHCrypto] Plain unencrypted JSON backup detected.');
      return parsed;
    }

    if (!parsed || parsed.magic !== REPORT_MAGIC || !parsed.ciphertext || (!parsed.salt && !parsed.encryptedKey) || !parsed.iv) {
      throw new Error('El archivo no es un reporte encriptado de JCAH_TGenX válido.');
    }

    // Asymmetric hybrid encryption support (Option A)
    if (parsed.algorithm === 'RSA-OAEP-2048+AES-GCM-256' || parsed.encryptedKey) {
      let privJwk = password;
      if (typeof password === 'string') {
        try { privJwk = JSON.parse(password); } catch (_) {}
      }
      if (privJwk && typeof privJwk === 'object' && (privJwk.kty || privJwk.d)) {
        return await decryptReportWithPrivateKey(parsed, privJwk);
      }
      throw new Error('Este reporte está protegido con cifrado asimétrico (RSA-OAEP). Ingrese la clave privada JWK del autor para descifrarlo.');
    }

    const subtle = getSubtleCrypto();
    const salt = new Uint8Array(base64ToBuffer(parsed.salt));
    const iv = new Uint8Array(base64ToBuffer(parsed.iv));
    const ciphertext = base64ToBuffer(parsed.ciphertext);

    // Candidate passwords to try
    const candidates = [];
    const examId = (parsed && parsed.examId) || (typeof window !== 'undefined' && window.__CURRENT_EXAM__ && window.__CURRENT_EXAM__.id) || '';
    if (password && typeof password === 'string' && password.trim()) {
      const p = password.trim();
      candidates.push(p);
      try {
        if (examId) candidates.push(await computeSHA256(p + '::' + examId));
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.__CURRENT_EXAM__) {
      const p = window.__CURRENT_EXAM__.reporting?.authorMasterPassword || window.__CURRENT_EXAM__.reportMasterPassword;
      if (p && !candidates.includes(p.trim())) {
        candidates.push(p.trim());
        try {
          if (examId) candidates.push(await computeSHA256(p.trim() + '::' + examId));
        } catch (_) {}
      }
    }

    let lastError = null;
    for (const pwd of candidates) {
      try {
        const key = await deriveKey(pwd, salt, ['decrypt']);
        const decrypted = await subtle.decrypt(
          { name: 'AES-GCM', iv: iv },
          key,
          ciphertext
        );
        const rawJson = bufferToString(decrypted);
        const report = JSON.parse(rawJson);
        console.log(`[JCAHCrypto] Successfully decrypted report using key: "${pwd === candidates[0] ? 'entered password' : 'contingency key'}"`);
        return report;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error('Contraseña incorrecta o el archivo de reporte está dañado / modificado.');
  }

  // -------------------------------------------------------------------------
  // 3. Salted SHA-256 for Code-Inspection Anti-Cheating
  // -------------------------------------------------------------------------
  /**
   * Computes SHA-256 hex digest of a string
   */
  async function computeSHA256(str) {
    const subtle = getSubtleCrypto();
    const buf = await subtle.digest('SHA-256', stringToBuffer(str));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Salted normalized answer hashing
   * Strips spaces, normalizes to lowercase, and hashes with exam salt
   */
  async function hashAnswer(answerText, salt) {
    const normalized = String(answerText || '').trim().toLowerCase();
    return await computeSHA256(`jcah_${salt}_${normalized}`);
  }

  /**
   * Generates obfuscated answer key map for local evaluation (Mode A)
   * This ensures plain-text answers NEVER appear in client-side code or variables.
   * @param {object} exam - exam object with questions
   * @returns {Promise<{ examSalt: string, secureKeyMap: object, sanitizedExam: object }>}
   */
  async function createObfuscatedLocalExam(exam) {
    const examSalt = bufferToBase64(getRandomValues(new Uint8Array(16)));
    const secureKeyMap = {}; // { [questionId]: { hash, type, pairsHashes, ... } }
    const sanitizedExam = JSON.parse(JSON.stringify(exam));

    async function processQuestions(qList, sectionName) {
      if (!Array.isArray(qList)) return;
      for (const q of qList) {
        if (!q.id) q.id = 'q_' + Math.random().toString(36).substr(2, 9);

        const normType = (q.type === 'multiple_choice' ? 'mc' : (q.type === 'true_false' ? 'tf' : (q.type === 'fill_blank' ? 'fb' : (q.type === 'multiple_response' ? 'mr' : q.type))));

        if (normType === 'mc' || normType === 'tf') {
          const expected = String(q.correct || '').trim();
          const hash = await hashAnswer(expected, examSalt);
          secureKeyMap[q.id] = { type: normType, hash };
        } else if (normType === 'fb') {
          const accepted = Array.isArray(q.correct) ? q.correct : [q.correct];
          const hashes = [];
          for (const a of accepted) {
            hashes.push(await hashAnswer(a, examSalt));
          }
          secureKeyMap[q.id] = { type: 'fb', hashes };
        } else if (normType === 'mr') {
          const accepted = Array.isArray(q.correct) ? q.correct : [q.correct];
          const hashes = [];
          for (const a of accepted) {
            hashes.push(await hashAnswer(a, examSalt));
          }
          hashes.sort();
          secureKeyMap[q.id] = { type: 'mr', hashes };
        } else if (q.type === 'matching') {
          const pairsHashes = {};
          const rights = [];
          if (Array.isArray(q.pairs)) {
            for (const p of q.pairs) {
              const leftKey = String(p.left || '').trim();
              const rightVal = String(p.right || '').trim();
              if (rightVal) rights.push(rightVal);
              const rightHash = await hashAnswer(rightVal, examSalt);
              pairsHashes[leftKey] = rightHash;
            }
          }
          secureKeyMap[q.id] = { type: 'matching', pairsHashes };
          const shuffled = rights.slice().sort(() => Math.random() - 0.5);
          q.shuffledRightChoices = shuffled;
          q.pairs = (q.pairs || []).map(p => ({ left: p.left, right: '' }));
        }

        // Clean from client object
        delete q.correct;
      }
    }

    if (sanitizedExam.vocabulary?.questions) {
      await processQuestions(sanitizedExam.vocabulary.questions, 'Vocab');
    }
    if (sanitizedExam.grammar?.questions) {
      await processQuestions(sanitizedExam.grammar.questions, 'Grammar');
    }
    if (Array.isArray(sanitizedExam.readingBanks)) {
      for (const bank of sanitizedExam.readingBanks) {
        for (const item of (bank.items || [])) {
          await processQuestions(item.questions, 'Reading');
        }
      }
    }
    if (Array.isArray(sanitizedExam.listeningBanks)) {
      for (const bank of sanitizedExam.listeningBanks) {
        for (const item of (bank.items || [])) {
          await processQuestions(item.questions, 'Listening');
        }
      }
    }

    sanitizedExam._salt = examSalt;
    sanitizedExam._secureKeyMap = secureKeyMap;
    sanitizedExam.examSalt = examSalt;
    sanitizedExam.secureKeyMap = secureKeyMap;
    return sanitizedExam;
  }

  // -------------------------------------------------------------------------
  // 4. Secure Random Password Generator Helper
  // -------------------------------------------------------------------------
  function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%&*';
    const randomVals = getRandomValues(new Uint8Array(length));
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[randomVals[i] % chars.length];
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 5. Asymmetric Offline Report Public-Key Encryption (Option A - N2)
  // -------------------------------------------------------------------------
  /**
   * Generates RSA-OAEP 2048-bit keypair for asymmetric offline report encryption.
   * Author retains privateKeyJwk; candidate package receives ONLY publicKeyJwk.
   */
  async function generateReportKeyPair() {
    const subtle = getSubtleCrypto();
    const keyPair = await subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]), // 65537
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );
    const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await subtle.exportKey('jwk', keyPair.privateKey);
    return { publicKeyJwk, privateKeyJwk };
  }

  /**
   * Encrypt candidate exam report object into an asymmetric hybrid container
   * using the author's public JWK. No private key or password verifier is shipped.
   * @param {object} reportPayload - candidate answers, scores, timestamps, photos
   * @param {object} publicKeyJwk - author's public JWK
   * @returns {Promise<string>} JSON string of the encrypted report
   */
  async function encryptReportWithPublicKey(reportPayload, publicKeyJwk) {
    if (!publicKeyJwk || typeof publicKeyJwk !== 'object') {
      throw new Error('La clave pública de reporte (JWK) es inválida o no está configurada.');
    }
    const subtle = getSubtleCrypto();
    const rsaPublicKey = await subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );

    // Random AES-256-GCM symmetric content encryption key
    const aesKey = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const rawAesKey = await subtle.exportKey('raw', aesKey);

    // Encrypt AES key with RSA-OAEP
    const encryptedKey = await subtle.encrypt(
      { name: 'RSA-OAEP' },
      rsaPublicKey,
      rawAesKey
    );

    // Encrypt payload with AES-GCM
    const iv = getRandomValues(new Uint8Array(12));
    const rawJson = JSON.stringify(reportPayload);
    const ciphertext = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      stringToBuffer(rawJson)
    );

    const container = {
      magic: REPORT_MAGIC,
      version: 2,
      algorithm: 'RSA-OAEP-2048+AES-GCM-256',
      createdAt: new Date().toISOString(),
      studentId: reportPayload.studentId || 'N/A',
      studentName: reportPayload.studentName || 'N/A',
      examTitle: reportPayload.examTitle || 'JCAH Exam',
      examId: reportPayload.examId || '',
      encryptedKey: bufferToBase64(encryptedKey),
      iv: bufferToBase64(iv),
      ciphertext: bufferToBase64(ciphertext),
      checksum: await computeSHA256(rawJson),
    };

    return JSON.stringify(container, null, 2);
  }

  /**
   * Decrypt asymmetric hybrid container using the author's private JWK.
   * @param {object|string} container - encrypted report container
   * @param {object} privateKeyJwk - author's private JWK
   * @returns {Promise<object>} decrypted report object
   */
  async function decryptReportWithPrivateKey(container, privateKeyJwk) {
    let parsed = container;
    if (typeof container === 'string') {
      try {
        parsed = JSON.parse(container);
      } catch (e) {
        throw new Error('El archivo no tiene un formato JSON válido.');
      }
    }
    if (!parsed || parsed.magic !== REPORT_MAGIC || !parsed.encryptedKey || !parsed.ciphertext || !parsed.iv) {
      throw new Error('El archivo no es un reporte asimétrico cifrado de JCAH_TGenX válido.');
    }
    if (!privateKeyJwk || typeof privateKeyJwk !== 'object') {
      throw new Error('Clave privada JWK requerida para descifrar el reporte.');
    }

    const subtle = getSubtleCrypto();
    const rsaPrivateKey = await subtle.importKey(
      'jwk',
      privateKeyJwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );

    const rawAesKey = await subtle.decrypt(
      { name: 'RSA-OAEP' },
      rsaPrivateKey,
      base64ToBuffer(parsed.encryptedKey)
    );

    const aesKey = await subtle.importKey(
      'raw',
      rawAesKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(base64ToBuffer(parsed.iv)) },
      aesKey,
      base64ToBuffer(parsed.ciphertext)
    );

    return JSON.parse(bufferToString(decrypted));
  }

  return {
    REPORT_MAGIC,
    encryptReport,
    decryptReport,
    generateReportKeyPair,
    encryptReportWithPublicKey,
    decryptReportWithPrivateKey,
    computeSHA256,
    hashAnswer,
    createObfuscatedLocalExam,
    obfuscateExamAnswers: createObfuscatedLocalExam,
    generateRandomPassword,
    generateMasterPassword: generateRandomPassword,
  };
})();

// Dual-naming and environment exports
if (typeof window !== 'undefined') {
  window.JCAHCrypto = JCAHCrypto;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JCAHCrypto;
}
