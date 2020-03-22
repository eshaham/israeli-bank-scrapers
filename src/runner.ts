import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from './constants';
import { AdapterContext } from './adapter-context';
import { RunnerContext, RunnerContextOptions } from './runner-context';
import { Adapter } from './adapter';


// TODO adapter any
function runAdapter(runnerContext: RunnerContext, adapter: any) {
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
          (result: any) => {
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


function validateAdapters(adapters: Adapter[]) {
  if (!adapters) {
    return ['adapters list must be valid array'];
  }

  const errors: string[] = [];
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

export interface RunnerOptions extends RunnerContextOptions {}

export default async function runner(options: RunnerOptions, adapters: Adapter[], cleanupAdapters = []) {
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

  // run adapters
  adapters.forEach((adapter) => {
    result = result.then(() => {
      return runAdapter(runnerContext, adapter);
    });
  });

  // prepare result
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

  // run cleanup adapters
  cleanupAdapters.forEach((adapter) => {
    result = result.then((result) => {
      return runAdapter(runnerContext, adapter)
        .then(() => {
          return result; // ignore result of cleanup adapter
        })
        .catch(() => {
          return result; // ignore errors origin from cleanup adapter
        });
    });
  });

  result = result.then((response) => {
    return response;
  });

  return result;
}
