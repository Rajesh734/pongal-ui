import { existsSync } from 'node:fs';
import path from 'node:path';

export const SITE_NAME = 'Eastcoast Tamil Community';
export const SITE_LOCATION = 'New Hampshire, USA';

/** Public URL of the logo in `imgDir` (logo.svg preferred over logo.png), or null when there is none. */
export function findLogo(imgDir) {
  for (const file of ['logo.svg', 'logo.png']) {
    if (existsSync(path.join(imgDir, file))) return `/public/img/${file}`;
  }
  return null;
}
