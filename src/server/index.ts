// Entry point: serves the built client from dist/public and runs the game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from './http/server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [path.resolve(here, '../../public'), path.resolve(here, '../../dist/public')];
const staticDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
if (!staticDir) console.warn('Client build not found (run `pnpm build:client`); serving API only.');

createGame({ staticDir });
