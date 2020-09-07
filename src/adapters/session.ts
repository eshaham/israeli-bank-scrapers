import { RunnerAdapter } from '@core/runner';

export interface ExportSessionDataOptions {
  sessionDataKey: string;
  targetProperty: string;
}
export function exportSessionData(options: ExportSessionDataOptions): RunnerAdapter {
  return {
    name: 'exportSessionData()',
    validate: (context) => {
      const result = [];

      if (!options.sessionDataKey) {
        result.push('expected options to contain \'sessionDataKey\'');
      } else if (!context.hasSessionData(options.sessionDataKey)) {
        result.push(`expected context to contain '${options.sessionDataKey}'`);
      }

      if (!options.targetProperty) {
        result.push('expected options to provide \'targetProperty\'');
      }

      return result;
    },
    action: async (context) => {
      const { sessionDataKey, targetProperty } = options;

      const value = context.getSessionData(sessionDataKey);

      context.addAdapterData({
        [targetProperty]: value,
      });
    },
  };
}

export interface SetSessionDataOptions {
  sessionDataKey: string;
  sessionDataValue: any;
}

export function setSessionData(options: SetSessionDataOptions): RunnerAdapter {
  return {
    name: 'setSessionData()',
    validate: () => {
      const result = [];

      if (!options.sessionDataKey) {
        result.push('expected options to contain \'sessionDataKey\'');
      }

      if (!options.sessionDataKey) {
        result.push('expected options to provide \'sessionDataValue\'');
      }

      return result;
    },
    action: async (context) => {
      const { sessionDataKey, sessionDataValue } = options;
      context.setSessionData(sessionDataKey, sessionDataValue);
    },
  };
}
