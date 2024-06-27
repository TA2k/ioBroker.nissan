/*eslint no-import-assign: "error"*/

// const crypto = require('crypto')
/*
  v3
  const { Blowfish } = require('egoroof-blowfish');
  v4
  const { Blowfish } = import('egoroof-blowfish');
  https://stackoverflow.com/questions/70396400/how-to-use-es6-modules-in-commonjs
  https://www.npmjs.com/package/eslint-import-resolver-typescript
*/
 
let Blowfish;
import('egoroof-blowfish').then(mod => {
  Blowfish = mod.Blowfish; }
);

module.exports = (password, passwordEncryptionKey) => {
  // const cipher = crypto.createCipheriv('bf-ecb', Buffer.from(passwordEncryptionKey), Buffer.from(''))
  // let encrypted = cipher.update(password, 'utf8', 'base64')
  // encrypted += cipher.final('base64')
  const bf = new Blowfish(passwordEncryptionKey, Blowfish.MODE.ECB, Blowfish.PADDING.PKCS5); // only key isn't optional
  // @ts-ignore
  const encoded = bf.encode(password, Blowfish.TYPE.STRING);
  //convert to base64
  const encodedB64 = Buffer.from(encoded).toString('base64');
  return encodedB64;
};
