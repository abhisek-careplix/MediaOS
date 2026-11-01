// Bring the studio's data back from Cloud Storage onto this server's disk: every file the disk is missing.
//   node app/scripts/restore.mjs           fetch what's missing
//   node app/scripts/restore.mjs --dry     list what would be fetched
//   node app/scripts/restore.mjs --force   also replace files whose size differs from the stored copy
// On the VM:  cd ~/videogen && sudo docker compose exec videogen node app/scripts/restore.mjs
import '../lib/localenv.mjs';
import { restore, storageOn } from '../lib/storage.mjs';

if (!storageOn()) { console.error('MEDIA_BUCKET is not set: there is nothing to restore from.'); process.exit(1); }
const dry = process.argv.includes('--dry'), force = process.argv.includes('--force');
const r = await restore({ dry, force });
console.log(`${r.objects} stored files: ${dry ? 'would fetch' : 'fetched'} ${r.fetched} (${(r.bytes / 1e6).toFixed(1)} MB), ${r.kept} already on disk.`);
