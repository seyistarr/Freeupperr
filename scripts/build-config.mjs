import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
import { configuration } from '../config/public-config.mjs';
export { configuration, production, productionMarkers } from '../config/public-config.mjs';
export async function build(env, directory = root) {
    const config = configuration(env);
    const guard = await fs.readFile(path.join(root, 'config/runtime-guard.js'), 'utf8');
    await fs.writeFile(path.join(directory, 'runtime-config.js'),
        '/* Generated public configuration; contains no server credentials. */\n' +
        'globalThis.FreeUpperConfig = ' + JSON.stringify(config).replaceAll('<', '\\u003c') + ';\n' + guard);
    if (config.environment === 'staging') {
        // A build runs in a clean checkout. Rewrite only staging output; production HTML stays unchanged.
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.html')) {
            const file = path.join(directory, entry.name);
            const source = await fs.readFile(file, 'utf8');
            await fs.writeFile(file, source.replaceAll('https://www.freeupper.com', config.appOrigin).replaceAll('https://freeupper.com', config.appOrigin).replaceAll('https://freeupper.vercel.app', config.appOrigin));
        }
    }
    return config;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await build(process.env); console.log('Public configuration built for ' + process.env.VERCEL_ENV); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
