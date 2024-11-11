const maxWaitTime = 30000;

module.exports = async (interval, fn) => {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const retry = async (fn) => {
      if (startTime > startTime + maxWaitTime) {
        resolve('{status:"timeout"}');
      }

      let data = {};

      try {
        data = await fn();

        if (!data.responseFlag) {
          console.log(data);
          resolve(JSON.stringify(data));
        }

        if (data.responseFlag === '0') {
          setTimeout(() => retry(fn), interval);
        } else {
          resolve(JSON.stringify(data, null, 2));
        }
      } catch (error) {
        resolve('{status:"error"}');
        console.log(error);
      }
    };

    retry(fn);
  });
};
