import _ from 'lodash';
import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from '../constants';


const noop = () => {};

class RunnerContext {
  constructor(options) {
    this.data = {};
    this.sessionData = {};
    this.notifyProgress = options.onProgress || noop;
    this.errorResult = null;
  }

  setErrorResult(errorResult) {
    this.errorResult = errorResult;
  }
}

class AdapterContext {
  constructor(adapterName, runnerContext) {
    this._runnerContext = runnerContext;
    this._adapterName = adapterName;
  }

  addAdapterData(adapterData) {
    this._runnerContext.data = _.merge(this._runnerContext.data, adapterData);
  }

  hasSessionData(key) {
    return typeof this._runnerContext.sessionData[key] !== 'undefined';
  }

  getSessionData(key) {
    return this._runnerContext.sessionData[key];
  }

  setSessionData(key, value) {
    this._runnerContext.sessionData[key] = value;
  }

  notifyProgress(state) {
    this._runnerContext.notifyProgress(this._adapterName, state);
  }
}

function runAdapter(runnerContext, adapter) {
  const adapterContext = new AdapterContext(adapter.name, runnerContext);

  adapterContext.notifyProgress(SCRAPE_PROGRESS_TYPES.VALIDATE_ADAPTER);
  return Promise.resolve(adapter.validate(adapterContext))
    .then((validationErrors) => {
      if (validationErrors && validationErrors.length) {
        return Promise.reject(
          new Error(validationErrors.join('. ')),
        );
      }

      adapterContext.notifyProgress(SCRAPE_PROGRESS_TYPES.START_ADAPTER);
      return adapter.action(adapterContext)
        .then(
          (result) => {
            if (result) {
              if (typeof result.success === 'boolean' && !result.success) {
                runnerContext.setErrorResult(result);
                throw new Error('adapter resulted with error');
              }

              if (result.data) {
                adapterContext.addAdapterData(result.data);
              }
            }

            adapterContext.notifyProgress(SCRAPE_PROGRESS_TYPES.END_ADAPTER);
          },
        );
    })
    .catch((e) => {
      adapterContext.notifyProgress(SCRAPE_PROGRESS_TYPES.FAILED_ADAPTER);
      throw e;
    });
}


function validateAdapters(adapters) {
  if (!adapters) {
    return ['adapters list must be valid array'];
  }

  const errors = [];
  adapters.forEach((adapter, i) => {
    if (!adapter) {
      errors.push(`adapter in index ${i} cannot be null`);
      return;
    }

    if (typeof adapter.name !== 'string') {
      errors.push(`adapter in index ${i} is missing a 'name' property of type string`);
    }

    if (typeof adapter.action !== 'function') {
      errors.push(`adapter in index ${i} is missing an 'action' property of type function`);
    }

    if (typeof adapter.validate !== 'function') {
      errors.push(`adapter in index ${i} is missing a 'validate' property of type function`);
    }
  });

  return errors;
}

export default async function runner(options, adapters) {
  const validations = validateAdapters(adapters);

  if (validations.length > 0) {
    return Promise.resolve({
      success: false,
      errorType: GENERAL_ERROR,
      errorMessage: validations.join('. '),
    });
  }

  const runnerContext = new RunnerContext(options);

  let result = Promise.resolve();

  adapters.forEach(adapter => {
    result = result.then(() => {
      return runAdapter(runnerContext, adapter);
    });
  });

  result = result
    .then(() => {
      return {
        success: true,
        data: runnerContext.data,
      };
    })
    .catch((e) => {
      if (runnerContext.errorResult) {
        return runnerContext.errorResult;
      }

      return {
        success: false,
        errorType: GENERAL_ERROR,
        errorMessage: e.message,
      };
    });

  return result;
}
