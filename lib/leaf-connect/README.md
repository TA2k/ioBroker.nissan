# leaf-connect

Node.js client library for the Nissan Leaf API

## Requirements

Install [node.js](https://nodejs.org/en/)

## Installation
```js
npm install leaf-connect
```


## Usage

### Example

See [examples/index.js](examples/index.js)

### Setup client
```js
const leafConnect = require('leaf-connect')

try {
  const client = await leafConnect({
    username: 'your-nissan-you@email.com',
    password: 'password'
    /*
      regionCode: 'NE', // See "region codes" section in docs
      locale: 'en-US',
      debug: true.
      pollingInterval: 30000 // in seconds
    */
  })
} catch (error) {
  console.error(error)
}
```

### Methods

#### sessionInfo
```js
client.sessionInfo()
```

#### status
```js
await client.status()
```

#### cachedStatus
```js
await client.cachedStatus()
```

#### climateControlStatus
```js
await client.climateControlStatus()
```

#### climateControlTurnOn
```js
await client.climateControlTurnOn()
```

#### climateControlTurnOff
```js
await client.climateControlTurnOff()
```

#### chargingStart
```js
await client.chargingStart()
```

#### history
```js
await client.history()
```

#### location (removed?)
```js
await client.location()
```

# Region codes

| Region | Code |
|--------|------|
| Europe | NE   |
| Canada | NCI  |
| USA    | NNA  |
| Australia | NMA |
| Japan | NML |

# Acknowledgements

This library was inspired by [Jason Horne's](https://github.com/jdhorne) [`pywings2`](https://github.com/jdhorne/pycarwings2) Carwings library for Python.

# License

[MIT](LICENSE)

# About

Created with ❤  for [Alheimsins](https://alheimsins.net)

<img src="https://image.ibb.co/dPH08G/logo_black.png" height="150px" width="150px" />
