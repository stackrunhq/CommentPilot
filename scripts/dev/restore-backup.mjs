import {restoreBackup,verifyBackup} from '../../src/storage/full-backup.js';
const [source,destination]=process.argv.slice(2);if(!source)throw Error('Usage: node scripts/dev/restore-backup.mjs BACKUP_FOLDER [NEW_DATA_FOLDER]');
if(destination)console.log(await restoreBackup(source,destination));else {const m=await verifyBackup(source);console.log({valid:true,files:m.entries.length});}
