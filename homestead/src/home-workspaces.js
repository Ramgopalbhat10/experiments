import {Project} from './project.js';
import {starterProject} from './starter.js';
import {WELLS_BRANCH,wellsBranchProject} from './homes/wells-branch.js';
/** Separate persistence namespaces: opening a reference never replaces the sandbox. */
export function loadHomeWorkspace(storage,workspace){try{const saved=storage.getItem(workspace.storage);return {project:new Project(saved?JSON.parse(saved):workspace.create()),canSave:true,message:null};}catch{return {project:new Project(workspace.create()),canSave:false,message:'Your stored save could not be read and has been kept untouched. Export your work or confirm a reset before replacing it.'};}}
export function homeWorkspace(search=''){
 const property=new URLSearchParams(search).get('home')===WELLS_BRANCH.id;
 return property?{property:true,title:WELLS_BRANCH.title,storage:'homestead-project-wells-branch-v1',create:wellsBranchProject}:{property:false,title:'The Cedar House',storage:'homestead-project-v1',create:starterProject};
}
