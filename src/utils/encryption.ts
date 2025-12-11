import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
  }
  // Use SHA-256 to derive a consistent 32-byte key
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypts a string using AES-256-GCM
 * @param plaintext The string to encrypt
 * @returns Base64 encoded encrypted string with IV and auth tag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine IV + Auth Tag + Encrypted data
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'base64'),
  ]);

  return combined.toString('base64');
}

/**
 * Decrypts an AES-256-GCM encrypted string
 * @param encryptedText Base64 encoded encrypted string
 * @returns Decrypted plaintext string
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedText, 'base64');

  // Extract IV, Auth Tag, and Encrypted data
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Encrypts a JSON object
 * @param data The object to encrypt
 * @returns Base64 encoded encrypted string
 */
export function encryptJSON<T>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts to a JSON object
 * @param encryptedText Base64 encoded encrypted string
 * @returns Decrypted object
 */
export function decryptJSON<T>(encryptedText: string): T {
  return JSON.parse(decrypt(encryptedText));
}

/**
 * Hashes a password using PBKDF2
 * @param password The password to hash
 * @returns Base64 encoded hash with salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return Buffer.concat([salt, hash]).toString('base64');
}

/**
 * Verifies a password against a hash
 * @param password The password to verify
 * @param storedHash The stored hash to compare against
 * @returns True if password matches
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const combined = Buffer.from(storedHash, 'base64');
  const salt = combined.subarray(0, SALT_LENGTH);
  const originalHash = combined.subarray(SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return crypto.timingSafeEqual(originalHash, hash);
}
