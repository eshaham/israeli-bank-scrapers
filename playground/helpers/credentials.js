import { encrypt, decrypt } from './crypto';

export function encryptCredentials(credentials) {
  const encrypted = {};
  Object.keys(credentials).forEach((field) => {
    encrypted[field] = encrypt(credentials[field]);
  });
  return encrypted;
}

export function decryptCredentials(credentials) {
  const decrypted = {};
  Object.keys(credentials).forEach((field) => {
    decrypted[field] = decrypt(credentials[field]);
  });
  return decrypted;
}
