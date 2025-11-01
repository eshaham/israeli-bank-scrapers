import { type Page } from 'puppeteer';
import { randomDelay } from './waiting';

export type BotFightingOptions = {
  withRandomDelay?: boolean;
  withMouseMove?: boolean;
};

export function randomMouseMove(page: Page): Promise<void> {
  const viewport = page.viewport();
  const width = viewport?.width || 1024;
  const height = viewport?.height || 768;
  const x = Math.random() * width;
  const y = Math.random() * height;
  return page.mouse.move(x, y);
}

export default async function fightBotDetection(
  page: Page,
  { withRandomDelay = false, withMouseMove = false }: BotFightingOptions = {},
): Promise<void> {
  if (withRandomDelay) {
    await randomDelay();
  }
  if (withMouseMove) {
    await randomMouseMove(page);
  }
}
