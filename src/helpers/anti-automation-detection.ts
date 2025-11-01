import { type Page } from 'puppeteer';
import { randomDelay } from './waiting';
import { type BotFightingOptions } from '../scrapers/interface';

export function randomMouseMove(page: Page): Promise<void> {
  const viewport = page.viewport();
  const width = viewport?.width || 1024;
  const height = viewport?.height || 768;
  const x = Math.random() * width;
  const y = Math.random() * height;
  return page.mouse.move(x, y);
}

export default async function fightBotDetection(page: Page, options: BotFightingOptions): Promise<void> {
  const withRandomDelay = options?.withRandomDelay ?? false;
  const withMouseMove = options?.withMouseMove ?? false;

  if (withRandomDelay) {
    await randomDelay();
  }
  if (withMouseMove) {
    await randomMouseMove(page);
  }
}
