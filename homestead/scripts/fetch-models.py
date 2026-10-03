#!/usr/bin/env python3
"""Download validated Poly Haven CC0 models before running the local optimization recipe."""
import argparse,hashlib,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('assets',nargs='*',default=['GothicBed_01','electric_stove']);p.add_argument('--root',default='public/models');args=p.parse_args()
def download(url):return subprocess.check_output(['curl','-fLsS','--retry','2','--max-time','90',url])
for asset in args.assets:
 files=json.loads(download('https://api.polyhaven.com/files/'+asset))['gltf']['1k']['gltf'];folder=pathlib.Path(args.root)/asset;folder.mkdir(parents=True,exist_ok=True)
 for name,entry in {'model.gltf':files,**files['include']}.items():
  data=download(entry['url'])
  if hashlib.md5(data).hexdigest()!=entry['md5']:raise ValueError('Source checksum mismatch: '+name)
  target=folder/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 provenance={'asset':asset,'source':'https://polyhaven.com/a/'+asset,'license':'CC0-1.0','license_url':'https://polyhaven.com/license','files_api':'https://api.polyhaven.com/files/'+asset,'source_files':files}
 (folder/'PROVENANCE.json').write_text(json.dumps(provenance,indent=2)+'\n')
 print('Downloaded and verified',asset)
