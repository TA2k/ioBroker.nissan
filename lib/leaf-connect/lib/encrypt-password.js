const crypto = require('crypto')

module.exports = (password, passwordEncryptionKey) => {
  const cipher = crypto.createCipheriv('bf-ecb', Buffer.from(passwordEncryptionKey), Buffer.from(''))
  let encrypted = cipher.update(password, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}
