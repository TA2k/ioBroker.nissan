
'use strict';

const axios = require('axios');
const { stringify } = require('qs');
const encryptPassword = require('./lib/encrypt-password');
const extractData = require('./lib/extract-data');
const retryUntilSuccess = require('./lib/retry-until-success');
const logger = require('./lib/logger');

const API_ENDPOINT = 'https://gdcportalgw.its-mo.com/api_v230317_NE/gdc/';
const INITIAL_APP_STR = '9s5rfKVuMrT03RtzajWNcA';
const RESULT_POLLING_INTERVAL = 20000;
const REGION_CODES = ['NE', 'NCI', 'NNA', 'NMA', 'NML'];

module.exports = async ({ username, password, regionCode = 'NE', locale = 'en-US', debug = false, pollingInterval = RESULT_POLLING_INTERVAL }) => {
  if (!username) {
    throw Error('Missing required username parameter');
  }

  if (!password) {
    throw Error('Missing required password parameter');
  }

  if (!REGION_CODES.includes(regionCode)) {
    throw Error(`"${regionCode}" is an unsupported regionCode.\nSupported region codes is: ${REGION_CODES.join(', ')}`);
  }

  const log = logger(debug);

  // @ts-ignore
  const apiInstance = axios.create({
    baseURL: API_ENDPOINT,
    method: 'post',
    transformRequest: [(data) => stringify(data)],
  });

  apiInstance.interceptors.request.use((config) => {
    log(`Request to ${config.baseURL + config.url}`);
    return config;
  });

  apiInstance.interceptors.response.use((response) => {
    log(`Response from ${response.config.baseURL + response.config.url}: ${response.status}`);
    return response;
  });

  let sessionState = {
    baseprm: false,
    loggedIn: false,
    info: {},
    requestOptions: {},
  };

  try {
    const { data } = await apiInstance({
      url: 'InitialApp_v2.php',
      data: {
        initial_app_str: INITIAL_APP_STR,
        RegionCode: regionCode,
        lg: locale,
      },
    });

    sessionState.baseprm = data.baseprm;
  } catch (error) {
    if (error instanceof Error) throw Error(`Cloud not connect to ${API_ENDPOINT}:\n ${error.message}`);
  }

  const { data } = await apiInstance({
    url: 'UserLoginRequest.php',
    data: {
      initial_app_str: INITIAL_APP_STR,
      RegionCode: regionCode,
      lg: locale,
      UserId: username,
      Password: encryptPassword(password, sessionState.baseprm),
    },
  });

  if (data.status !== 200) {
    throw Error(`Could not login - status: ${data.status} - message: ${data.message}`);
  }

  try {
    sessionState.requestOptions = extractData(data);
  } catch (error) {
    throw Error(`Could not extract session data: ${error} \n${JSON.stringify(data, null, 2)}`);
  }

  sessionState = {
    ...sessionState,
    loggedIn: true,
    info: data,
  };

  return {
    sessionInfo: () => JSON.stringify(sessionState.info, null, 2),

    status: async () => {
      const { data } = await apiInstance({ url: 'BatteryStatusCheckRequest.php', data: sessionState.requestOptions });
      const { resultKey } = data;

      const runStatusResult = async () => {
        const { data } = await apiInstance({
          url: 'BatteryStatusCheckResultRequest.php',
          data: {
            ...sessionState.requestOptions,
            resultKey,
          },
        });

        return data;
      };

      return retryUntilSuccess(pollingInterval, runStatusResult);
    },

    cachedStatus: async () => {
      const { data } = await apiInstance({ url: 'BatteryStatusRecordsRequest.php', data: sessionState.requestOptions });

      return JSON.stringify(data, null, 2);
    },

    climateControlStatus: async () => {
      const { data } = await apiInstance({ url: 'RemoteACRecordsRequest.php', data: sessionState.requestOptions });

      return JSON.stringify(data, null, 2);
    },

    climateControlTurnOn: async () => {
      const { data } = await apiInstance({ url: 'ACRemoteRequest.php', data: sessionState.requestOptions });
      const { resultKey } = data;

      const runClimateControlTurnOnResult = async () => {
        const { data } = await apiInstance({
          url: 'ACRemoteResult.php',
          data: {
            ...sessionState.requestOptions,
            resultKey,
          },
        });
        return data;
      };

      return retryUntilSuccess(pollingInterval, runClimateControlTurnOnResult);
    },

    climateControlTurnOff: async () => {
      const { data } = await apiInstance({ url: 'ACRemoteOffRequest.php', data: sessionState.requestOptions });
      const { resultKey } = data;

      const runClimateControlTurnOffResult = async () => {
        const { data } = await apiInstance({
          url: 'ACRemoteOffResult.php',
          data: {
            ...sessionState.requestOptions,
            resultKey,
          },
        });

        return data;
      };

      return retryUntilSuccess(pollingInterval, runClimateControlTurnOffResult);
    },

    chargingStart: async () => {
      const { data } = await apiInstance({ url: 'BatteryRemoteChargingRequest.php', data: sessionState.requestOptions });

      return JSON.stringify(data, null, 2);
    },

    history: async (date) => {
      const { data } = await apiInstance({
        url: 'CarKarteDetailInfoRequest.php',
        data: {
          ...sessionState.requestOptions,
          TargetDate: date,
        },
      });

      return JSON.stringify(data, null, 2);
    },

    location: async () => {
      const { data } = await apiInstance({ url: 'MyCarFinderRequest.php', data: sessionState.requestOptions });
      const { resultKey } = data;

      const runLocationResult = async () => {
        const { data } = await apiInstance({
          url: 'MyCarFinderResultRequest.php',
          data: {
            ...sessionState.requestOptions,
            resultKey,
          },
        });

        return data;
      };

      return retryUntilSuccess(pollingInterval, runLocationResult);
    },

    lastLocation: async () => {
      const { data } = await apiInstance({ url: 'MyCarFinderLatLng.php', data: sessionState.requestOptions });

      return JSON.stringify(data, null, 2);
    },
  };
};
