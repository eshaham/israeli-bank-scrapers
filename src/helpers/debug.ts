import debug from 'debug';

export function getDebug(name: string) {
  return debug(`israeli-bank-scrapers:${name}`);
}
