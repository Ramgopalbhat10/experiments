import {mkdir,writeFile} from 'node:fs/promises';
import {wellsBranchProject} from '../src/homes/wells-branch.js';
const root=new URL('../public/examples/',import.meta.url);await mkdir(root,{recursive:true});await writeFile(new URL('10593-wells-branch.homestead.json',root),JSON.stringify(wellsBranchProject(),null,2)+'\n');console.log('Exported Wells Branch v1 project.');
