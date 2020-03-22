import { AdapterContext } from './adapter-context';

export interface Adapter {
  name: string,
  validate: (context: AdapterContext) => string[],
  action: (context: AdapterContext) => Promise<{ success: boolean, errorType?: any}>
}
