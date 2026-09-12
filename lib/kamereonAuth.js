'use strict';

/**
 * Port von KamereonSession-Auth aus HomeAssistant-NissanConnect (kamereon.py)
 * auf den neuen MyNISSAN OneID PKCE-Flow.
 *
 * Ersetzt den alten NissanConnect-Login.
 *
 */

const axios = require('axios');
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');

class NissanAuthError extends Error {
	// Wird nur geworfen, wenn Nissan die Zugangsdaten selbst ablehnt
	// (entspricht 1:1 der Python NissanAuthError).
}

function decodeHtmlEntities(str) {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/**
 * Ersetzt Python's _LoginFormParser: sucht im HTML das Formular, das
 * "sessionDataKey" UND "password" als Input-Felder enthält.
 * @param html
 */
function extractLoginForm(html) {
	const formRegex = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
	let match;
	while ((match = formRegex.exec(html)) !== null) {
		const formTag = match[0];
		const formBody = match[1];
		const actionMatch = /action=["']([^"']*)["']/i.exec(formTag);
		const action = actionMatch ? decodeHtmlEntities(actionMatch[1]) : null;

		const inputs = {};
		const inputRegex = /<input\b[^>]*>/gi;
		let inputMatch;
		while ((inputMatch = inputRegex.exec(formBody)) !== null) {
			const inputTag = inputMatch[0];
			const nameMatch = /name=["']([^"']*)["']/i.exec(inputTag);
			if (!nameMatch) continue;
			const valueMatch = /value=["']([^"']*)["']/i.exec(inputTag);
			inputs[nameMatch[1]] = valueMatch ? decodeHtmlEntities(valueMatch[1]) : '';
		}

		if ('sessionDataKey' in inputs && 'password' in inputs) {
			return { action, inputs };
		}
	}
	return null;
}

class KamereonSession {
	/**
	 * @param {object} settings  Entspricht SETTINGS_MAP[tenant][region] aus
	 *                           kamereon_const.py. Muss mind. enthalten:
	 *                           auth_base_url, redirect_uri, client_id, scope,
	 *                           auth_locale, auth_brand, auth_client,
	 *                           user_base_url, auth_platform, kamereon_scope
	 * @param {object} [log]     ioBroker this.log (optional, sonst console)
	 */
	constructor(settings, log) {
		this.settings = settings;
		this.log = log || console;
		this._oauthToken = null;
		this._kamereonRefreshToken = null;
		this._username = null;
		this._password = null;
		this._isLoggedIn = false;
		this._resetHttp();
	}

	isLoggedIn() {
		return this._isLoggedIn && !!this._oauthToken;
	}

	// Neue Session = neuer Cookie-Jar, genau wie Python's requests.session()
	// bei jedem login()-Aufruf neu erstellt wird.
	_resetHttp() {
		const jar = new CookieJar();
		this.http = axios.create({
			httpAgent: new HttpCookieAgent({ cookies: { jar } }),
			httpsAgent: new HttpsCookieAgent({ cookies: { jar } }),
			maxRedirects: 0, // Redirects werten wir selbst aus (wie allow_redirects=False)
			validateStatus: () => true, // 3xx/4xx nicht als Exception werfen
			timeout: 30000,
		});
	}

	static _generatePkcePair() {
		const verifier = crypto.randomBytes(64).toString('base64url');
		const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
		return { verifier, challenge };
	}

	_isAuthUrl(url) {
		try {
			const expected = new URL(this.settings.auth_base_url);
			const parsed = new URL(url);
			const expectedPort = expected.port || (expected.protocol === 'https:' ? '443' : '80');
			const parsedPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
			return parsed.protocol === 'https:' && parsed.hostname === expected.hostname && parsedPort === expectedPort;
		} catch {
			return false;
		}
	}

	// Robuster Vergleich mit redirect_uri - auch bei custom URI-Schemes
	// (z.B. "com.nissan.icar://oauth2redirect"), die die WHATWG URL-Klasse
	// je nach Format unterschiedlich parst.
	_matchesRedirectUri(target) {
		const configured = this.settings.redirect_uri;
		try {
			const t = new URL(target);
			const c = new URL(configured);
			return t.protocol === c.protocol && t.host === c.host;
		} catch {
			return target.startsWith(configured);
		}
	}

	async _followLoginRedirects(response, currentUrl) {
		let resp = response;
		let url = currentUrl;
		for (let i = 0; i < 10; i++) {
			if (resp.status >= 300 && resp.status < 400) {
				const location = resp.headers.location;
				if (!location) break;
				const target = new URL(location, url).toString();
				if (!this._isAuthUrl(target)) {
					throw new Error('Unexpected Nissan login redirect');
				}
				try {
					resp = await this.http.get(target);
				} catch {
					throw new Error('Unable to load Nissan login');
				}
				url = target;
				continue;
			}
			if (resp.status >= 200 && resp.status < 300 && this._isAuthUrl(url)) {
				return { response: resp, url };
			}
			break;
		}
		throw new Error('Unable to load Nissan login');
	}

	async _followAuthorizationRedirects(response, currentUrl) {
		let resp = response;
		let url = currentUrl;
		for (let i = 0; i < 10; i++) {
			if (resp.status >= 300 && resp.status < 400) {
				const location = resp.headers.location;
				if (!location) break;
				const target = new URL(location, url).toString();
				if (this._matchesRedirectUri(target)) {
					return target;
				}
				if (!this._isAuthUrl(target)) {
					throw new Error('Unexpected Nissan authorization redirect');
				}
				try {
					resp = await this.http.get(target);
				} catch {
					throw new Error('Unable to complete Nissan login');
				}
				url = target;
				continue;
			}
			if (resp.status >= 200 && resp.status < 300) {
				const form = extractLoginForm(resp.data);
				if (form) {
					// Login-Formular kommt erneut -> Zugangsdaten falsch
					throw new NissanAuthError('Invalid credentials');
				}
			}
			break;
		}
		throw new Error('Nissan login did not return an authorization code');
	}

	async _authorizationCode(username, password) {
		const { verifier, challenge } = KamereonSession._generatePkcePair();
		const state = crypto.randomBytes(32).toString('base64url');

		const authorizeUrl = new URL('oauth2/authorize', this.settings.auth_base_url).toString();
		let resp;
		try {
			resp = await this.http.get(authorizeUrl, {
				params: {
					response_type: 'code',
					redirect_uri: this.settings.redirect_uri,
					client_id: this.settings.client_id,
					state,
					scope: this.settings.scope,
					code_challenge: challenge,
					code_challenge_method: 'S256',
					locale: this.settings.auth_locale,
					brand: this.settings.auth_brand,
					client: this.settings.auth_client,
				},
			});
		} catch {
			throw new Error('Unable to contact Nissan login');
		}

		const { response, url } = await this._followLoginRedirects(resp, authorizeUrl);

		const form = extractLoginForm(response.data);
		if (!form || !form.action) {
			throw new Error('Nissan login form is unavailable');
		}

		const loginRegion = form.inputs.regionCode || '';
		const loginData = Object.assign({}, form.inputs, {
			userName: username,
			username: loginRegion ? `${loginRegion}/${username}` : username,
			password: password,
		});

		const formUrl = new URL(form.action, url).toString();
		if (!this._isAuthUrl(formUrl)) {
			throw new Error('Unexpected Nissan login form target');
		}
		const formOrigin = new URL(formUrl);

		let postResp;
		try {
			postResp = await this.http.post(formUrl, new URLSearchParams(loginData).toString(), {
				headers: {
					Origin: `${formOrigin.protocol}//${formOrigin.host}`,
					Referer: url,
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});
		} catch {
			throw new Error('Unable to submit Nissan login');
		}

		const callbackUrl = await this._followAuthorizationRedirects(postResp, formUrl);

		if (!this._matchesRedirectUri(callbackUrl)) {
			throw new Error('Unexpected Nissan login callback');
		}

		const callback = new URL(callbackUrl);
		if (callback.searchParams.get('state') !== state) {
			throw new Error('Invalid Nissan login state');
		}
		const code = callback.searchParams.get('code');
		if (!code) {
			throw new NissanAuthError('Invalid credentials');
		}
		return { code, verifier };
	}

	async _parseTokenResponse(response, tokenName, requireIdToken = false) {
		let data = response.data;
		if (typeof data === 'string') {
			try {
				data = JSON.parse(data);
			} catch {
				throw new Error(`Invalid ${tokenName} response`);
			}
		}
		const ok = response.status >= 200 && response.status < 300;
		if (!ok || !data || data.error || !data.access_token) {
			throw new Error(`Unable to obtain ${tokenName}`);
		}
		if (requireIdToken && !data.id_token) {
			throw new Error(`Missing ID token in ${tokenName} response`);
		}
		return data;
	}

	async _exchangeWso2Token(code, verifier) {
		const tokenUrl = new URL('oauth2/token', this.settings.auth_base_url).toString();
		const resp = await this.http.post(
			tokenUrl,
			new URLSearchParams({
				redirect_uri: this.settings.redirect_uri,
				grant_type: 'authorization_code',
				client_id: this.settings.client_id,
				code,
				code_verifier: verifier,
				scope: this.settings.scope,
			}).toString(),
			{ headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
		);
		return this._parseTokenResponse(resp, 'Nissan OneID token', true);
	}

	async _exchangeKamereonToken(wso2IdToken) {
		const url = new URL('v1/oauth2/access_token', this.settings.user_base_url).toString();
		const resp = await this.http.post(url, null, {
			params: { platform: this.settings.auth_platform },
			headers: {
				Authorization: wso2IdToken,
				'Content-Type': 'application/vnd.api+json',
			},
		});
		return this._parseTokenResponse(resp, 'Kamereon token');
	}

	_installKamereonToken(token) {
		const expiresIn = parseInt(token.expires_in || 3600, 10);
		const refreshToken = token.refresh_token || this._kamereonRefreshToken;
		this._oauthToken = {
			access_token: token.access_token,
			token_type: token.token_type || 'Bearer',
			expires_in: expiresIn,
			expires_at: Date.now() / 1000 + expiresIn,
		};
		this._kamereonRefreshToken = refreshToken;
	}

	async _refreshKamereonToken() {
		if (!this._kamereonRefreshToken) {
			throw new Error('No Kamereon refresh token available');
		}
		const url = new URL('v1/oauth2/refresh-token', this.settings.user_base_url).toString();
		const resp = await this.http.post(url, JSON.stringify({ scope: this.settings.kamereon_scope }), {
			params: { platform: this.settings.auth_platform },
			headers: {
				Authorization: this._kamereonRefreshToken,
				'Content-Type': 'application/vnd.api+json',
			},
		});
		this._installKamereonToken(await this._parseTokenResponse(resp, 'Kamereon refresh token'));
	}

	async _refreshAuthentication() {
		try {
			await this._refreshKamereonToken();
		} catch (e) {
			if (this.log.debug) this.log.debug(`Kamereon token refresh failed, logging in again: ${e}`);
			await this.login();
		}
	}

	/**
	 * Entspricht login() aus kamereon.py. username/password beim ersten Aufruf
	 * mitgeben, danach reicht login() ohne Argumente (nutzt gemerkte Daten).
	 * @param username
	 * @param password
	 */
	async login(username, password) {
		this._isLoggedIn = false;
		if (username !== undefined) this._username = username;
		if (password !== undefined) this._password = password;
		if (!this._username || !this._password) {
			throw new Error('Credentials are required');
		}

		this._resetHttp(); // frischer Cookie-Jar pro Login-Versuch
		const { code, verifier } = await this._authorizationCode(this._username, this._password);
		const wso2Token = await this._exchangeWso2Token(code, verifier);
		this._installKamereonToken(await this._exchangeKamereonToken(wso2Token.id_token));
		this._isLoggedIn = true;
	}

	/**
	 * Ersetzt session.request()/OAuth2Session-Retry-Logik. Für normale
	 * Kamereon-API-Calls (car_adapter_base_url etc.) verwenden - NICHT für
	 * den Login-Flow selbst.
	 * @param method
	 * @param url
	 * @param options
	 */
	async request(method, url, options = {}) {
		for (let attempt = 0; attempt < 2; attempt++) {
			if (!this._oauthToken || this._oauthToken.expires_at <= Date.now() / 1000 + 30) {
				await this._refreshAuthentication();
			}
			const headers = Object.assign({}, options.headers, {
				Authorization: `${this._oauthToken.token_type} ${this._oauthToken.access_token}`,
			});
			const resp = await this.http.request(
				Object.assign({}, options, {
					method,
					url,
					headers,
					maxRedirects: 5, // API-Calls dürfen normal folgen
					validateStatus: () => true,
				}),
			);
			if (resp.status !== 401) {
				return resp;
			}
			if (attempt === 0) {
				await this._refreshAuthentication();
			}
		}
		//this._isLoggedIn = false;
		throw new Error('Token expired, refresh failed twice');
	}
}

module.exports = { KamereonSession, NissanAuthError };
