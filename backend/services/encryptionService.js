import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16 bytes

function getDerivedKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function getCandidateKeys() {
  const secrets = new Set();
  if (process.env.ENCRYPTION_KEY) secrets.add(process.env.ENCRYPTION_KEY);
  if (process.env.JWT_SECRET) secrets.add(process.env.JWT_SECRET);
  secrets.add('super_secret_querydesk_jwt_key_2026');
  secrets.add('querydesk_default_secret_encryption_key_2026');
  return Array.from(secrets).map(getDerivedKey);
}

export function encrypt(text) {
  if (!text) return null;
  const primaryKey = getCandidateKeys()[0];
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, primaryKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decrypt(text) {
  if (!text) return null;

  // Format check: encrypted strings are `32-hex-chars-IV:hex-encrypted-data`
  const parts = text.split(':');
  const ivHex = parts[0];
  const encryptedHex = parts.slice(1).join(':');

  // AES-256-CBC IV is exactly 16 bytes (32 hex characters)
  if (parts.length < 2 || ivHex.length !== 32 || !/^[0-9a-fA-F]+$/.test(ivHex)) {
    // Not in IV:Encrypted format (e.g. unencrypted plain Telegram token like 123456789:ABC...)
    return text;
  }

  const keys = getCandidateKeys();
  for (const key of keys) {
    try {
      const iv = Buffer.from(ivHex, 'hex');
      const encryptedText = Buffer.from(encryptedHex, 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      if (decrypted) return decrypted;
    } catch (err) {
      // Try next candidate key
    }
  }

  console.warn('[Encryption] Decryption failed for text with available keys.');
  return null;
}
