import {db} from '../lib/db';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
mkdirSync('data/backups',{recursive:true});const path=join('data/backups',`research-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);db.backup(path).then(()=>console.log(`Backup saved: ${path}`)).catch(e=>{console.error(e);process.exitCode=1;});
