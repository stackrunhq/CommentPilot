import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Both source checkout and staged backend retain src/app under the application root.
export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const uiRoot=path.join(projectRoot,'src','ui');
