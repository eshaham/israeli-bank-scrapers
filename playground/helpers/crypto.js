import crypto from 'crypto';

const ALGORITHM = 'aes-256-ctr';
const SALT = '8cs+8Y(nxDLY';

export function encrypt(text) {
  const cipher = crypto.createCipher(ALGORITHM, SALT);
  const crypted = cipher.update(text, 'utf8', 'hex');
  return crypted + cipher.final('hex');
}

export function decrypt(text) {
  const decipher = crypto.createDecipher(ALGORITHM, SALT);
  const decrypted = decipher.update(text, 'hex', 'utf8');
  return decrypted + decipher.final('utf8');
}
