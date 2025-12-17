import { createHash } from 'crypto';

/**
 * Generate a deterministic UUID v5-like identifier based on input strings
 * This ensures the same input always produces the same UUID, enabling upsert behavior
 *
 * @param namespace - A namespace string (e.g., 'product-media', 'visibility')
 * @param parts - Variable number of string parts to combine
 * @returns A 32-character hex string suitable for Shopware UUIDs
 */
export function generateDeterministicUuid(namespace: string, ...parts: string[]): string {
  const input = [namespace, ...parts].join(':');
  const hash = createHash('md5').update(input).digest('hex');
  // Return first 32 characters (Shopware uses 32-char hex UUIDs without dashes)
  return hash.substring(0, 32);
}

/**
 * Generate a random UUID v4
 * @returns A 32-character hex string suitable for Shopware UUIDs
 */
export function generateRandomUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }

  // Simple UUID v4 implementation
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
