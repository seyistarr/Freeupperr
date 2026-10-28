// Run after an intentional pinned i18next upgrade; commit both files.
import {copyFile} from 'node:fs/promises';
await copyFile('node_modules/i18next/dist/esm/i18next.js','js/vendor/i18next.js');
await copyFile('node_modules/i18next/LICENSE','js/vendor/i18next.LICENSE');
