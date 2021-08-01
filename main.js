"use strict";

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const axiosCookieJarSupport = require("axios-cookiejar-support").default;
const tough = require("tough-cookie");
const { extractKeys } = require("./lib/extractKeys");
class Nissan extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "nissan",
        });
        this.on("ready", this.onReady.bind(this));
        // this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        if (this.config.interval < 0.5) {
            this.log.info("Set interval to minimum 0.5");
            this.config.interval = 0.5;
        }
        axiosCookieJarSupport(axios);
        this.cookieJar = new tough.CookieJar();
        this.requestClient = axios.create();
        this.updateInterval = null;
        this.extractKeys = extractKeys;
        this.session = {};
        this.subscribeStates("*");

        await this.login();
        if (this.session.acces_token) {
            await this.getVehicles();
            await this.updateVehicles();
            this.updateInterval = setInterval(async () => {
                await this.updateVehicles();
            }, this.config.interval * 60 * 1000);
        }
    }
    async login() {
        const nonce = this.getNonce();
        const headers = {
            "Accept-Api-Version": "protocol=1.0,resource=2.1",
            "X-Username": "anonymous",
            "X-Password": "anonymous",
            "Content-Type": "application/json",
            Accept: "application/json",
        };
        const jwtToken = await this.requestClient({
            method: "post",
            url: encodeURIComponent(
                "https://prod.eu.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate?locale=de&goto=https://prod.eu.auth.kamereon.org:443/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-prod-ios&response_type=code&state=31C4BA5B&locale=de&nonce=" +
                    nonce +
                    "&redirect_uri=com.acms.nci://oauth2&scope=openid%20profile%20vehicles"
            ),
            jar: this.cookieJar,
            withCredentials: true,
            headers: headers,
        })
            .then((res) => {
                this.log.debug(res.data);
                return res.data;
            })
            .catch((error) => {
                this.log.error(error);
            });
        try {
            jwtToken.callbacks[0].input[0].value = this.config.user;
            jwtToken.callbacks[1].input[0].value = this.config.password;
            await this.requestClient({
                method: "post",
                url: encodeURIComponent(
                    "https://prod.eu.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate?locale=de&goto=https://prod.eu.auth.kamereon.org:443/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-prod-ios&response_type=code&state=31C4BA5B&locale=de&nonce=" +
                        nonce +
                        "&redirect_uri=com.acms.nci://oauth2&scope=openid%20profile%20vehicles"
                ),

                jar: this.cookieJar,
                withCredentials: true,
                headers: headers,
                data: jwtToken,
            })
                .then((res) => {
                    this.log.debug(res.data);
                    return res.data;
                })
                .catch((error) => {
                    this.log.error(error);
                });
            await this.requestClient({
                method: "get",
                url: encodeURIComponent(
                    "https://prod.eu.auth.kamereon.org/kauth/json/realms/root/realms/a-ncb-prod/authenticate?locale=de&goto=https://prod.eu.auth.kamereon.org:443/kauth/oauth2/a-ncb-prod/authorize?client_id=a-ncb-prod-ios&response_type=code&state=31C4BA5B&locale=de&nonce=" +
                        nonce +
                        "&redirect_uri=com.acms.nci://oauth2&scope=openid%20profile%20vehicles"
                ),

                jar: this.cookieJar,
                withCredentials: true,
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
            })
                .then((res) => {
                    this.log.debug(res.data);
                    return res.data;
                })
                .catch((error) => {
                    this.log.error(error);
                });
        } catch (error) {
            this.log.error(error);
        }
    }
    async getVehicles() {}
    async updateVehicles() {}
    getNonce() {
        //FF48AAFD017F43E6AA9022677CED2DC2
        const length = 32;
        const result = [];
        const characters = "ABCDEF0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
        }
        return result.join("");
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            clearInterval(this.updateInterval);

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
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
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
