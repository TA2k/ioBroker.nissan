
/*
let Blowfish;
import('egoroof-blowfish').then(mod => {
  Blowfish = mod.Blowfish; }
);

module.exports = (password, passwordEncryptionKey) => {
  // const cipher = crypto.createCipheriv('bf-ecb', Buffer.from(passwordEncryptionKey), Buffer.from(''))
  // let encrypted = cipher.update(password, 'utf8', 'base64')
  // encrypted += cipher.final('base64')
  const bf = new Blowfish(passwordEncryptionKey, Blowfish.MODE.ECB, Blowfish.PADDING.PKCS5); // only key isn't optional
  const encoded = bf.encode(password, Blowfish.TYPE.STRING);
  //convert to base64
  const encodedB64 = Buffer.from(encoded).toString('base64');
  return encodedB64;
};
*/

const crypto = require('crypto');
module.exports = (password, key, iv) => {
  const keyBuffer = Buffer.from(key, 'utf8');
  const ivBuffer = Buffer.from(iv, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, ivBuffer);
  let encrypted = cipher.update(password, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};
