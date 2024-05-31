'use strict';

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const leafConnect = require('./lib/leaf-connect');
// const leafConnect = require("leaf-connect");
const qs = require('qs');

const { HttpsCookieAgent } = require('http-cookie-agent/http');
const tough = require('tough-cookie');
const { extractKeys } = require('./lib/extractKeys');
class Nissan extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'nissan',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.isInLogin = false;
    this.cookieJar = new tough.CookieJar();
    this.requestClient = axios.create({
      withCredentials: true,
      httpsAgent: new HttpsCookieAgent({
        cookies: {
          jar: this.cookieJar,
        },
      }),
    });
    this.updateInterval = null;
    this.extractKeys = extractKeys;
    this.vinArray = [];
    this.session = {};
    this.canGen = {};
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Initialize your adapter here

    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);
    if (this.config.interval < 0.5) {
      this.log.info('Set interval to minimum 0.5');
      this.config.interval = 0.5;
    }

    this.subscribeStates('*');

    if (!this.config.user || !this.config.password) {
      this.log.error('Please set username and password');
      return;
    }

    if (this.config.nissanev) {
      try {
        this.log.info('Start Connecting to Nissan EV');
        await this.loginEV();
        this.setState('info.connection', true, true);
        this.log.info('Connected to Nissan EV');
        await this.getNissanEvVehicles();
      } catch (error) {
        this.log.error(error);
      }

      this.updateNissanEv();
      this.updateInterval = setInterval(async () => {
        await this.updateNissanEv();
      }, this.config.interval * 60 * 1000);
      this.refreshTokenInterval = setInterval(async () => {
        await this.loginEV();
      }, 22 * 60 * 60 * 1000);

      return;
    }

    await this.login();
    if (this.session.access_token) {
      await this.getVehicles();
      if (this.config.forceRefresh) {
        this.log.info('Force Refresh is active. Please check your 12V Battery');
      } else {
        this.log.info('Force Refresh is not active. Updates only when you refresh in the App or via nissan.0.xx.remote.refresh');
      }
      await this.updateVehicles(this.config.forceRefresh).catch((error) => {
        this.log.error(error);
      });
      this.updateInterval = setInterval(async () => {
        await this.updateVehicles(this.config.forceRefresh).catch((error) => {
          this.log.error(error);
        });
      }, this.config.interval * 60 * 1000);
      this.refreshTokenInterval = setInterval(() => {
        this.refreshToken();
      }, this.session.expires_in * 1000);
    }
  }
  async loginEV() {
    try {
      if (this.isInLogin) {
        return;
      }
      this.isInLogin = true;
      this.nissanEvClient = await leafConnect({
        username: this.config.user,
        password: this.config.password,
        regionCode: 'NE',
        locale: 'de-DE',
        debug: false,
        // pollingInterval: 30000, // in seconds
      }).catch((error) => {
        this.log.error(error);
      });
      this.isInLogin = false;
    } catch (error) {
      this.isInLogin = false;
      this.log.error(error);
    }
  }

  async updateNissanEv() {
    try {
      this.log.debug('Update Nissan EV');
      if (!this.nissanEvClient) {
        this.log.warn('Nissan EV not connected. Start Relogin');
        this.loginEV();
        return;
      }
      this.log.debug('cachedStatus');
      const cachedStatus = await this.nissanEvClient.cachedStatus().catch((error) => {
        this.log.error(error);
      });
      this.log.debug(cachedStatus);
      if (JSON.parse(cachedStatus).status === 401) {
        this.log.debug('Nissan EV Session expired. Start Relogin');
        await this.loginEV();
      }
      this.extractKeys(this, this.vehicle.vin + '.cachedStatus', JSON.parse(cachedStatus));

      this.log.debug('climateStatus');
      const climateStatus = await this.nissanEvClient.climateControlStatus().catch((error) => {
        this.log.error(error);
      });
      this.log.debug(climateStatus);

      this.extractKeys(this, this.vehicle.vin + '.climateStatus', JSON.parse(climateStatus));

      this.log.debug('history');
      const history = await this.nissanEvClient.history().catch((error) => {
        this.log.error(error);
      });
      this.log.debug(history);
      this.extractKeys(this, this.vehicle.vin + '.history', JSON.parse(history));

      this.log.debug('status');
      const status = await this.nissanEvClient.status().catch((error) => {
        this.log.error(error);
      });
      this.log.debug(status);
      if (JSON.parse(status).status === 401) {
        this.log.info('Nissan EV Session expired. Start Relogin');
        await this.loginEV();
      }
      this.extractKeys(this, this.vehicle.vin + '.status', JSON.parse(status));
    } catch (error) {
      this.log.error(error);
    }
  }
  async getNissanEvVehicles() {
    this.log.debug(this.nissanEvClient.sessionInfo());
    this.vehicle = JSON.parse(this.nissanEvClient.sessionInfo()).vehicle.profile;

    await this.setObjectNotExistsAsync(this.vehicle.vin, {
      type: 'device',
      common: {
        name: this.vehicle.nickname || this.vehicle.registrationNumber || this.vehicle.modelName,
        role: 'indicator',
      },
      native: {},
    });
    await this.setObjectNotExistsAsync(this.vehicle.vin + '.remote', {
      type: 'channel',
      common: {
        name: 'Remote Controls',
        role: 'indicator',
      },
      native: {},
    });
    const remoteArray = [
      { command: 'climateControlTurnOn' },
      { command: 'climateControlTurnOff' },
      { command: 'chargingStart' },
      { command: 'refresh', name: 'Force Refresh' },
    ];
    remoteArray.forEach((remote) => {
      this.setObjectNotExists(this.vehicle.vin + '.remote.' + remote.command, {
        type: 'state',
        common: {
          name: remote.name || '',
          type: remote.type || 'boolean',
          role: remote.role || 'boolean',
          write: true,
          read: true,
        },
        native: {},
      });
    });
  }

  async login() {
    const nonce = this.getNonce();
    const headers = {
      'Accept-Api-Version': 'protocol=1.0,resource=2.0',
      'X-Username': 'anonymous',
      'X-Password': 'anonymous',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-NoSession': 'true',
      Accept: 'application/json',
    };
    const jwtToken = await this.requestClient({
      method: 'post',
      url:
        'https://prod.eu2.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate?locale=de&goto=' +
        encodeURIComponent(
          'https://prod.eu2.auth.kamereon.org:443/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-nc-android-prod&response_type=code&state=B5C9DC90&locale=de&nonce=' +
            nonce +
            '&redirect_uri=org.kamereon.service.nci:/oauth2redirect&scope=openid%20profile%20vehicles&response_type=code&prompt=',
        ),
      jar: this.cookieJar,
      withCredentials: true,
      headers: headers,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return res.data;
      })
      .catch((error) => {
        this.log.error('JWT');
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    if (!jwtToken) {
      this.log.error('JWT Token not found');
      return;
    }
    try {
      jwtToken.callbacks[0].input[0].value = this.config.user;
      jwtToken.callbacks[1].input[0].value = this.config.password;
      await this.requestClient({
        method: 'post',
        url:
          'https://prod.eu2.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate?locale=de&goto=' +
          encodeURIComponent(
            'https://prod.eu2.auth.kamereon.org:443/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-nc-android-prod&response_type=code&state=B5C9DC90&locale=de&nonce=' +
              nonce +
              '&redirect_uri=org.kamereon.service.nci:/oauth2redirect&scope=openid%20profile%20vehicles&response_type=code&prompt=',
          ),

        jar: this.cookieJar,
        withCredentials: true,
        headers: headers,
        data: jwtToken,
      })
        .then((res) => {
          this.log.debug(JSON.stringify(res.data));
          return res.data;
        })
        .catch((error) => {
          this.log.error('Post JWT');
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
      const code = await this.requestClient({
        method: 'get',
        url:
          'https://prod.eu2.auth.kamereon.org/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-nc-android-prod&nonce=' +
          nonce +
          '&redirect_uri=org.kamereon.service.nci:/oauth2redirect&locale=de&state=B5C9DC90&scope=openid%20profile%20vehicles&response_type=code&prompt=',
        jar: this.cookieJar,
        withCredentials: true,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
        .then((res) => {
          this.log.debug(JSON.stringify(res.data));
          return res.data;
        })
        .catch((error) => {
          const code = '';
          if (error.message && error.message.includes('Unsupported protocol')) {
            if (error.config) {
              this.log.debug(JSON.stringify(error.config.url));
              const parameters = qs.parse(error.request._options.path.split('?')[1]);
              this.log.debug(JSON.stringify(parameters));
              return parameters.code;
            }
            return code;
          }
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
      if (!code) {
        this.log.error('No code received');
        return;
      }
      await this.requestClient({
        method: 'post',
        url: 'https://prod.eu2.auth.kamereon.org/kauth/oauth2/a-ncb-prod/access_token',

        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          Accept: 'application/json',
          'user-agent': 'NissanConnect/1 CFNetwork/1240.0.4 Darwin/20.6.0',
        },
        data: qs.stringify({
          redirect_uri: 'org.kamereon.service.nci:/oauth2redirect',
          client_id: 'a-ncb-nc-android-prod',
          client_secret: '6GKIax7fGT5yPHuNmWNVOc4q5POBw1WRSW39ubRA8WPBmQ7MOxhm75EsmKMKENem',
          grant_type: 'authorization_code',
          code: code,
        }),
      })
        .then((res) => {
          this.log.debug(JSON.stringify(res.data));
          this.session = res.data;
          this.setState('info.connection', true, true);
          this.log.info('Login successful');
          return res.data;
        })
        .catch((error) => {
          this.log.error('Access token');
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    } catch (error) {
      this.log.error(error);
    }
  }
  async getVehicles() {
    const headers = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'User-Agent': 'NissanConnect/1 CFNetwork/1240.0.4 Darwin/20.6.0',
      Authorization: 'Bearer ' + this.session.access_token,
      'Accept-Language': 'de-de',
    };
    this.userId = await this.requestClient({
      method: 'get',
      url: 'https://alliance-platform-usersadapter-prod.apps.eu2.kamereon.io/user-adapter/v1/users/current',
      headers: headers,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return res.data.userId;
      })
      .catch((error) => {
        this.log.error(error);
      });
    await this.requestClient({
      method: 'get',
      url: 'https://nci-bff-web-prod.apps.eu2.kamereon.io/bff-web/v5/users/' + this.userId + '/cars',
      headers: headers,
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        this.log.info(`Found ${res.data.data.length} vehicles`);
        for (const vehicle of res.data.data) {
          this.vinArray.push(vehicle.vin);
          await this.setObjectNotExistsAsync(vehicle.vin, {
            type: 'device',
            common: {
              name: vehicle.nickname || vehicle.registrationNumber || vehicle.modelName,
              role: 'indicator',
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(vehicle.vin + '.remote', {
            type: 'channel',
            common: {
              name: 'Remote Controls',
              role: 'indicator',
            },
            native: {},
          });
          const remoteArray = [
            { command: 'wake-up-vehicle' },
            { command: 'refresh-battery-status' },
            { command: 'refresh-hvac-status' },
            { command: 'refresh-location' },
            { command: 'hvac-start', name: 'AC True=Start False=Stop' },
            { command: 'hvac-targetTemperature', name: 'AC Target Temperature', type: 'number', role: 'value' },
            { command: 'charging-start' },
            { command: 'engine-start' },
            { command: 'horn-lights' },
            { command: 'lock-unlock' },
            { command: 'refresh', name: 'Force Refresh' },
          ];
          remoteArray.forEach((remote) => {
            this.setObjectNotExists(vehicle.vin + '.remote.' + remote.command, {
              type: 'state',
              common: {
                name: remote.name || '',
                type: remote.type || 'boolean',
                role: remote.role || 'boolean',
                write: true,
                read: true,
              },
              native: {},
            });
          });
          this.canGen[vehicle.vin] = vehicle.canGeneration;
          this.extractKeys(this, vehicle.vin + '.general', vehicle);
        }
      })
      .catch((error) => {
        this.log.error('Failing to get cars');
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }
  async updateVehicles(forceRefresh) {
    const date = new Date();
    let month = date.getMonth() + 1;
    month = (month > 9 ? '' : '0') + month;
    const yyyymmm = date.getFullYear() + '' + month;
    const statusArray = [
      { path: 'health-status', url: 'https://nci-bff-web-prod.apps.eu2.kamereon.io/bff-web/v1/cars/$vin/health-status?canGen=$gen' },
      { path: 'battery-status', url: 'https://nci-bff-web-prod.apps.eu2.kamereon.io/bff-web/v1/cars/$vin/battery-status?canGen=$gen' },
      { path: 'lock-status', url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v1/cars/$vin/lock-status' },
      { path: 'hvac-status', url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v1/cars/$vin/hvac-status' },
      { path: 'location', url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v1/cars/$vin/location' },
      { path: 'cockpit', url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v2/cars/$vin/cockpit' },
      {
        path: 'trip-history',
        url:
          'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v1/cars/$vin/trip-history/?type=month&start=' +
          yyyymmm +
          '&end=' +
          yyyymmm,
      },
      {
        path: 'notification',
        url: 'https://alliance-platform-notifications-prod.apps.eu2.kamereon.io/notifications/v2/notifications/users/$user/vehicles/$vin?from=1&langCode=DE&order=DESC&realm=a-ncb&to=20',
      },
    ];
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      Accept: '*/*',
      'User-Agent': 'NissanConnect/2 CFNetwork/978.0.7 Darwin/18.7.0',
      Authorization: 'Bearer ' + this.session.access_token,
    };
    this.vinArray.forEach(async (vin) => {
      if (forceRefresh) {
        await this.setRemoteCommand('refresh-battery-status', true, vin);
        await this.setRemoteCommand('refresh-location', true, vin);
        await this.setRemoteCommand('wake-up-vehicle', true, vin);
        await this.sleep(25000);
      }
      statusArray.forEach(async (element) => {
        const url = element.url.replace('$vin', vin).replace('$gen', this.canGen[vin]).replace('$user', this.userId);
        await this.requestClient({
          method: 'get',
          url: url,
          headers: headers,
        })
          .then((res) => {
            this.log.debug(JSON.stringify(res.data));
            let data = res.data;
            if (data.data) {
              data = data.data;
            }
            if (data.attributes) {
              data = data.attributes;
            }
            let forceIndex = null;
            let preferedArrayName = null;
            if (element.path === 'notification') {
              forceIndex = true;
            }
            if (element.path === 'trip-history') {
              preferedArrayName = 'month';
              forceIndex = true;
            }
            this.extractKeys(this, vin + '.' + element.path, data, preferedArrayName, forceIndex);
          })
          .catch((error) => {
            this.log.error(`Failing to get ${element.path} for ${vin} code: ${error.response && error.response.status} `);

            if (error.response && error.response.status === 502) {
              return;
            }
            if (error.response && error.response.status === 401 && element.path === 'cockpit') {
              this.log.warn('Authentication error, trying to refresh token');
              this.refreshToken();
              return;
            }
            this.log.error(error);
            error.response && this.log.error(JSON.stringify(error.response.data));
          });
      });
    });
  }
  async refreshToken() {
    await this.requestClient({
      method: 'post',
      url: 'https://prod.eu2.auth.kamereon.org/kauth/oauth2/a-ncb-prod/access_token',

      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Accept: 'application/json',
      },
      data: qs.stringify({
        client_id: 'a-ncb-nc-android-prod',
        client_secret: '6GKIax7fGT5yPHuNmWNVOc4q5POBw1WRSW39ubRA8WPBmQ7MOxhm75EsmKMKENem',
        grant_type: 'refresh_token',
        refresh_token: this.session.refresh_token,
      }),
    })
      .then((res) => {
        this.log.debug('Refreshtoken success');
        this.log.debug(JSON.stringify(res.data));
        this.session.access_token = res.data.access_token;
        this.setState('info.connection', true, true);
        return res.data;
      })
      .catch((error) => {
        this.log.error('Refresh token failed');
        this.log.error(error);
      });
  }
  getNonce() {
    //FF48AAFD017F43E6AA9022677CED2DC2
    const length = 32;
    const result = [];
    const characters = 'ABCDEF0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
    }
    return result.join('');
  }
  convertToCamelCase(string) {
    const camelCaseString = string.replace(/-([a-z])/g, function (g) {
      return g[1].toUpperCase();
    });
    return camelCaseString.charAt(0).toUpperCase() + camelCaseString.slice(1);
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.adapterStopped = true;
      this.setState('info.connection', false, true);
      clearTimeout(this.refreshTimeout);

      clearInterval(this.updateInterval);
      clearInterval(this.refreshTokenInterval);

      callback();
    } catch (e) {
      callback();
    }
  }

  // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
  // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
  // /**
  //  * Is called if a subscribed object changes
  //  * @param {string} id
  //  * @param {ioBroker.Object | null | undefined} obj
  //  */
  // onObjectChange(id, obj) {
  //     if (obj) {
  //         // The object was changed
  //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
  //     } else {
  //         // The object was deleted
  //         this.log.info(`object ${id} deleted`);
  //     }
  // }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        if (id.indexOf('.remote.') === -1) {
          return;
        }
        const vin = id.split('.')[2];
        const command = id.split('.')[4];
        if (command === 'refresh') {
          if (this.config.nissanev) {
            this.updateNissanEv();
            return;
          }
          this.updateVehicles(true);
          return;
        }
        if (this.config.nissanev) {
          try {
            this.log.info('Start: ' + command);
            this.log.info(
              await this.nissanEvClient[command]().catch((error) => {
                this.log.error(error);
              }),
            );
          } catch (error) {
            this.log.error(error);
          }

          return;
        }
        const value = state.val;
        await this.setRemoteCommand(command, value, vin);
        this.refreshTimeout && clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(async () => {
          await this.updateVehicles(true);
        }, 25 * 1000);
      } else {
        const resultDict = { chargingStatus: 'charging-start', hvacStatus: 'hvac-start', lockStatus: 'lock-unlock' };
        const idArray = id.split('.');
        const stateName = idArray[idArray.length - 1];

        if (resultDict[stateName]) {
          this.log.debug('Receive ' + stateName + ' : ' + state.val + ' set remote ' + resultDict[stateName]);
          const vin = id.split('.')[2];
          let value = true;
          if (!state.val || state.val === 'off' || state.val === 'unlocked') {
            value = false;
          }
          await this.setStateAsync(vin + '.remote.' + resultDict[stateName], value, true);
        }
      }
    }
  }
  sleep(ms) {
    if (this.adapterStopped) {
      ms = 0;
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async setRemoteCommand(command, value, vin) {
    const headers = {
      'Content-Type': 'application/vnd.api+json',
      'User-Agent': 'NissanConnect/2 CFNetwork/978.0.7 Darwin/18.7.0',
      Accept: '*/*',
      'Accept-Language': 'de-de',
      Authorization: 'Bearer ' + this.session.access_token,
    };
    let data = {
      data: {
        type: this.convertToCamelCase(command),
      },
    };
    if (command.endsWith('-start')) {
      data = {
        data: {
          type: this.convertToCamelCase(command),
          attributes: {
            action: value ? 'start' : 'stop',
          },
        },
      };
    }
    if (command === 'hvac-start') {
      const tempState = await this.getStateAsync(vin + '.remote.hvac-targetTemperature');
      if (tempState && tempState.val) {
        data.data.attributes.targetTemperature = tempState.val;
      } else {
        data.data.attributes.targetTemperature = 21.0;
      }
    }
    if (command === 'horn-lights') {
      data = {
        data: {
          type: this.convertToCamelCase(command),
          attributes: {
            duration: 2,
            target: 'horn_lights',
          },
        },
      };
    }
    if (command === 'lock-unlock') {
      data = {
        data: {
          type: this.convertToCamelCase(command),
          attributes: {
            lock: value ? 'lock' : 'unlock',
          },
        },
      };
    }
    this.log.debug(JSON.stringify(data));
    const url = 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/v1/cars/' + vin + '/actions/' + command;

    await this.requestClient({
      method: 'post',
      url: url,
      headers: headers,
      data: data,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
      })
      .catch((error) => {
        this.log.error(error);
      });
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Nissan(options);
} else {
  // otherwise start the instance directly
  new Nissan();
}
