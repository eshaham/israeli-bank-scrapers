import _ from 'lodash';
import { RunnerContext } from './runner-context';

export class RunnerAdapterContext {
  private _adapterName: string;
  private _runnerContext: any;

  constructor(adapterName: string, runnerContext: RunnerContext) {
    this._runnerContext = runnerContext;
    this._adapterName = adapterName;
  }

  addAdapterData = (adapterData: Record<string, any>) => {
    this._runnerContext.data = _.merge(this._runnerContext.data, adapterData);
  }

  hasSessionData = (key: string) => {
    return typeof this._runnerContext.sessionData[key] !== 'undefined';
  }

  getSessionData = (key: string) => {
    return this._runnerContext.sessionData[key];
  }

  setSessionData = (key: string, value: any) => {
    this._runnerContext.sessionData[key] = value;
  }

  notifyProgress = (state: string) => {
    this._runnerContext.notifyProgress(this._adapterName, state);
  }
}

export interface RunnerAdapter {
  name: string;
  validate: (context: RunnerAdapterContext) => string[];
  action: (context: RunnerAdapterContext) => Promise<{ success: boolean; errorType?: any}>
    | Promise<void>;
}
