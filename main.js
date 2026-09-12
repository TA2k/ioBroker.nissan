'use strict';

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
// const leafConnect = require("leaf-connect");
// const qs = require('qs');

const { HttpsCookieAgent } = require('http-cookie-agent/http');
const tough = require('tough-cookie');
const { extractKeys } = require('./lib/extractKeys');

//NEW --
const { KamereonSession, NissanAuthError } = require('./lib/kamereonAuth.js');
const NISSAN_EU_SETTINGS = {
	client_id: 'ZM3WK7ax1OtQKYQ8Qqzcv5VgiA8a',
	scope: 'openid name profile email offline_access',
	kamereon_scope: 'openid profile vehicles',
	auth_base_url: 'https://login.mynissan-account.com/',
	redirect_uri: 'com://wso2.service.nci',
	auth_brand: 'Nissan',
	auth_client: 'mynissanapp',
	auth_platform: 'Android',
	auth_locale: 'en_GB',
	// unverändert aus eurem bisherigen Adapter übernehmen:
	car_adapter_base_url: 'https://alliance-platform-caradapter-prod.apps.eu2.kamereon.io/car-adapter/',
	notifications_base_url: 'https://alliance-platform-notifications-prod.apps.eu2.kamereon.io/notifications/',
	user_adapter_base_url: 'https://alliance-platform-usersadapter-prod.apps.eu2.kamereon.io/user-adapter/',
	// Nissan/Kamereon BFF
	user_base_url: 'https://nci-bff-web-prod.apps.eu2.kamereon.io/bff-web/',
};
//NEW ++
class Nissan extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
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
		//bolliy --
		this._isConnected = false;
		//this.isReady = false; //object path already created
		this.skipArray = [];

		//bolliy ++
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState('info.connection', this._isConnected, true);
		if (this.config.interval < 0.5) {
			this.log.info('Set interval to minimum 0.5');
			this.config.interval = 0.5;
		}

		//this.subscribeStates('*.remote.*');
		this.subscribeStates('*');

		if (!this.config.user || !this.config.password) {
			this.log.error('Please set username and password');
			return;
		}

		// beim Start:
		this.session = new KamereonSession(NISSAN_EU_SETTINGS, this.log);
		try {
			await this.session.login(this.config.user, this.config.password);
			this.log.info('Login successful');
			this.updateInfoConnection();
		} catch (e) {
			if (e instanceof NissanAuthError) {
				this.log.error('Login failed: Incorrect username/password');
			} else {
				this.log.error(`Login failed: ${e.message}`);
			}
			return;
		}

		await this.getVehicles();

		if (this.config.forceRefresh) {
			this.log.info('Force Refresh is active. Please check your 12V Battery');
		} else {
			this.log.info(
				'Force Refresh is not active. Updates only when you refresh in the App or via nissan.0.xx.remote.refresh',
			);
		}
		try {
			await this.updateVehicles(this.config.forceRefresh);
		} catch (e) {
			this.log.error(e);
		}

		this.updateInterval = this.setInterval(
			async () => {
				try {
					await this.updateVehicles(this.config.forceRefresh);
				} catch (e) {
					this.log.error(e);
				}
			},
			this.config.interval * 60 * 1000,
		);

		/*
		await this.login();
		if (this.session.access_token) {
			await this.getVehicles();
			if (this.config.forceRefresh) {
				this.log.info('Force Refresh is active. Please check your 12V Battery');
			} else {
				this.log.info(
					'Force Refresh is not active. Updates only when you refresh in the App or via nissan.0.xx.remote.refresh',
				);
			}
			await this.updateVehicles(this.config.forceRefresh).catch(error => {
				this.log.error(error);
			});
			this.updateInterval = setInterval(
				async () => {
					await this.updateVehicles(this.config.forceRefresh).catch(error => {
						this.log.error(error);
					});
				},
				this.config.interval * 60 * 1000,
			);
			this.refreshTokenInterval = setInterval(() => {
				this.refreshToken();
			}, this.session.expires_in * 1000);
		}
		*/
	}

	updateInfoConnection() {
		if (this._isConnected !== this.session.isLoggedIn()) {
			this._isConnected = this.session.isLoggedIn() || false;
			this.setState('info.connection', this._isConnected, true);
		}
	}

	responseIsOk(res) {
		return res.status === 200 && !!res.data && !res.data.errors;
	}

	async getVehicles() {
		let res;
		const headers = {
			'Content-Type': 'application/vnd.api+json',
			Accept: '*/*',
			'User-Agent': 'NissanConnect/1 CFNetwork/1240.0.4 Darwin/20.6.0',
			'Accept-Language': 'de-de',
		};

		//get user id
		try {
			res = await this.session.request('GET', `${NISSAN_EU_SETTINGS.user_adapter_base_url}v1/users/current`, {
				headers: headers,
			});
			this.log.debug(JSON.stringify(res.data));
			this.userId = res.data.userId;
		} catch (e) {
			this.log.error(`Error: ${e.message}`);
		}

		//get cars
		try {
			res = await this.session.request('GET', `${NISSAN_EU_SETTINGS.user_base_url}v5/users/${this.userId}/cars`, {
				headers: headers,
			});
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
				await this.setObjectNotExistsAsync(`${vehicle.vin}.remote`, {
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

				remoteArray.forEach(remote => {
					return this.setObjectNotExists(`${vehicle.vin}.remote.${remote.command}`, {
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
				this.extractKeys(this, `${vehicle.vin}.general`, vehicle);
			}
		} catch (e) {
			this.log.error('Failing to get car(s)');
			this.log.error(e);
			e.response && this.log.error(JSON.stringify(e.response.data));
		}
	}

	async updateVehicles(forceRefresh) {
		const date = new Date();
		const month = date.getMonth() + 1;
		const monthStr = (month > 9 ? '' : '0') + month;
		const yyyymmm = `${date.getFullYear()}${monthStr}`;
		const statusArray = [
			{
				path: 'health-status',
				url: `${NISSAN_EU_SETTINGS.user_base_url}v1/cars/$vin/health-status?canGen=$gen`,
			},
			{
				path: 'battery-status',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/$vin/battery-status`,
			},
			{
				path: 'battery-statusv2',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v2/cars/$vin/battery-status`,
			},
			{
				path: 'battery-statusv3',
				url: `${NISSAN_EU_SETTINGS.user_base_url}v3/cars/$vin/battery-status?canGen=$gen`,
			},
			{
				path: 'lock-status',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/$vin/lock-status`,
			},
			{
				path: 'hvac-status',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/$vin/hvac-status`,
			},
			{
				path: 'location',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/$vin/location`,
			},
			{
				path: 'cockpit',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v2/cars/$vin/cockpit`,
			},
			{
				path: 'trip-history',
				url: `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/$vin/trip-history/?type=month&start=${yyyymmm}&end=${yyyymmm}`,
			},
			{
				path: 'notification',
				url: `${NISSAN_EU_SETTINGS.notifications_base_url}v2/notifications/users/$user/vehicles/$vin?from=1&langCode=DE&order=DESC&realm=a-ncb&to=20`,
			},
		];
		const headers = {
			'Content-Type': 'application/vnd.api+json',
			Accept: '*/*',
			'User-Agent': 'NissanConnect/2 CFNetwork/978.0.7 Darwin/18.7.0',
		};
		this.vinArray.forEach(async vin => {
			if (forceRefresh) {
				await this.setRemoteCommand('refresh-battery-status', true, vin);
				await this.setRemoteCommand('refresh-location', true, vin);
				await this.setRemoteCommand('wake-up-vehicle', true, vin);
				await this.sleep(25000);
			}

			for (const element of statusArray) {
				const url = element.url.replace('$vin', vin).replace('$gen', this.canGen[vin]).replace('$user', this.userId);
				if (this.skipArray.includes(`${vin}.${element.path}`)) {
					continue;
				}
				try {
					const res = await this.session.request('GET', url, {
						headers: headers,
					});

					if (!this.responseIsOk(res)) {
						if (res.status === 501 || res.status === 404) {
							this.log.info(`Skip ${element.path} for ${vin} code: ${res.status} until next scheduled update`);
							this.skipArray.push(`${vin}.${element.path}`);
						} else {
							this.log.debug(JSON.stringify(res.data));
							this.log.error(
								`Failing to get ${element.path} for ${vin} code: ${res.status} ${res.data.errors[0].status}`,
							);
						}
						continue;
					}

					this.log.debug(`Status for ${vin} ${element.path}: ${JSON.stringify(res.data)}`);
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
					this.extractKeys(this, `${vin}.${element.path}`, data, preferedArrayName, forceIndex);
				} catch (error) {
					this.updateInfoConnection();
					if (
						error.response &&
						(error.response.status === 501 || error.response.status === 403 || error.response.status === 404)
					) {
						this.log.info(
							`Skip ${element.path} for ${vin} code: ${error.response && error.response.status} until next scheduled update`,
						);
						this.skipArray.push(`${vin}.${element.path}`);
						return;
					}
					this.log.error(`Failing to get ${element.path} for ${vin} code: ${error.response && error.response.status} `);
					if (error.response && error.response.status === 502) {
						return;
					}
					if (error.response && error.response.status === 401 && element.path === 'cockpit') {
						this.log.warn('Authentication error, trying to refresh token');
						//this.refreshToken();
						return;
					}
					this.log.error(error);
					error.response && this.log.error(JSON.stringify(error.response.data));
				}
				this.updateInfoConnection();

				/*
				await this.requestClient({
					method: 'get',
					url: url,
					headers: headers,
				})
					.then(res => {
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
						this.extractKeys(this, `${vin}.${element.path}`, data, preferedArrayName, forceIndex);
					})
					.catch(error => {
						if (
							error.response &&
							(error.response.status === 501 || error.response.status === 403 || error.response.status === 404)
						) {
							this.log.info(
								`Skip ${element.path} for ${vin} code: ${error.response && error.response.status} until next restart`,
							);
							this.skipArray.push(`${vin}.${element.path}`);
							return;
						}
						this.log.error(
							`Failing to get ${element.path} for ${vin} code: ${error.response && error.response.status} `,
						);

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
				*/
			} //of for loop
		}); //for each vin
	}

	/*
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
			.then(res => {
				this.log.debug('Refreshtoken success');
				this.log.debug(JSON.stringify(res.data));
				this.session.access_token = res.data.access_token;
				this.setState('info.connection', true, true);
				return res.data;
			})
			.catch(error => {
				this.log.error('Refresh token failed');
				this.log.error(error);
			});
	}
	*/

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
			this.log.info('cleaned everything up...');
			this.adapterStopped = true;
			this.setState('info.connection', false, true);
			this.refreshTimeout && clearTimeout(this.refreshTimeout);
			this.updateInterval && clearInterval(this.updateInterval);
			this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
			callback();
		} catch (e) {
			this.log.error(`Error during unload: ${e}`);
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
					this.updateVehicles(true);
					return;
				}
				const value = state.val;
				if (await this.setRemoteCommand(command, value, vin)) {
					await this.setState(id, value, true);
					// Command executed successfully
					this.refreshTimeout && clearTimeout(this.refreshTimeout);
					this.refreshTimeout = this.setTimeout(async () => {
						await this.updateVehicles(true);
					}, 25 * 1000);
				}
			} else {
				/*
				const resultDict = { chargingStatus: 'charging-start', hvacStatus: 'hvac-start', lockStatus: 'lock-unlock' };
				const idArray = id.split('.');
				const stateName = idArray[idArray.length - 1];

				if (resultDict[stateName]) {
					this.log.debug(`Receive ${stateName} : ${state.val} set remote ${resultDict[stateName]}`);
					const vin = id.split('.')[2];
					let value = true;
					if (!state.val || state.val === 'off' || state.val === 'unlocked') {
						value = false;
					}
					await this.setState(`${vin}.remote.${resultDict[stateName]}`, value, true);
				}
				*/
			}
		}
	}

	sleep(ms) {
		if (this.adapterStopped) {
			ms = 0;
		}
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	async setRemoteCommand(command, value, vin) {
		const headers = {
			'Content-Type': 'application/vnd.api+json',
			'User-Agent': 'NissanConnect/2 CFNetwork/978.0.7 Darwin/18.7.0',
			Accept: '*/*',
			'Accept-Language': 'de-de',
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
			const tempState = await this.getState(`${vin}.remote.hvac-targetTemperature`);
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
						//target: 'horn_lights',
						target: 'horn',
						action: value ? 'start' : 'stop',
					},
				},
			};
		}
		if (command === 'lock-unlock') {
			data = {
				data: {
					type: this.convertToCamelCase(command),
					attributes: {
						target: 'lock_unlock',
						action: value ? 'lock' : 'unlock',
					},
				},
			};
		}
		this.log.debug(`RemoteCommand ${command}: ${JSON.stringify(data)}`);
		const url = `${NISSAN_EU_SETTINGS.car_adapter_base_url}v1/cars/${vin}/actions/${command}`;

		try {
			const res = await this.session.request('POST', url, {
				headers: headers,
				data: data,
			});
			this.log.debug(`RemoteCommand response: ${JSON.stringify(res.data)}`);
			return this.responseIsOk(res);
		} catch (e) {
			this.log.error(e);
			return false;
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options]
	 */
	module.exports = options => new Nissan(options);
} else {
	// otherwise start the instance directly
	new Nissan();
}
