const noop = () => {};

export interface RunnerContextOptions {
  onProgress: (adapterName: string, message: string) => void;
}

export class RunnerContext {
  data: Record<string, any>;

  sessionData: Record<string, any>;

  notifyProgress: (adapterName: string, message: string) => void;

  errorResult: any;

  constructor(options: RunnerContextOptions) {
    this.data = {};
    this.sessionData = {};
    this.notifyProgress = options.onProgress || noop;
    this.errorResult = null;
  }

  setErrorResult(errorResult: any) {
    this.errorResult = errorResult;
  }
}
