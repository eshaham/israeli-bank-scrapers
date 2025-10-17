import { type Page } from 'puppeteer';

export function randomMouseMove(page: Page): Promise<void> {
  const viewport = page.viewport();
  const width = viewport?.width || 1024;
  const height = viewport?.height || 768;
  const x = Math.random() * width;
  const y = Math.random() * height;
  return page.mouse.move(x, y);
}