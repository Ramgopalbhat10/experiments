#!/usr/bin/env python3
"""Create GPU-compressed KTX2 and bounded JPEG fallbacks. Requires Pillow and toktx 4.4.2."""
import argparse,concurrent.futures,json,pathlib,subprocess
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--toktx',default='toktx');p.add_argument('--root',default='public');args=p.parse_args()
root=pathlib.Path(args.root);files=sorted(root.glob('textures/*.jpg'))+sorted(root.glob('models/*/textures/*.jpg'))
# Keep raw source downloads outside public when rerunning source acquisition.
def convert(source):
 name=source.name;normal='normal' in name or '_nor_' in name
 color='-color' in name or '_diff_' in name
 side=1024 if color else 512
 # Fallback JPEGs retain their names, but no longer allocate 2K images on weak GPUs.
 image=Image.open(source)
 if max(image.size)>side:
  image.thumbnail((side,side),Image.Resampling.LANCZOS)
  image.save(source,quality=90,optimize=True)
 target=source.with_suffix('.ktx2')
 isMaterial=source.parent.name=='textures' and source.parent.parent==root
 options=['--t2','--genmipmap','--assign_oetf','srgb' if color else 'linear','--threads','2']
 if isMaterial:options+=['--lower_left_maps_to_s0t0'] # TextureLoader uses flipY; glTF does not.
 if normal:options+=['--encode','uastc','--uastc_quality','2','--zcmp','6']
 else:options+=['--encode','etc1s','--qlevel','192']
 subprocess.run([args.toktx,*options,str(target),str(source)],check=True,capture_output=True)
 key='/'+str(source.relative_to(root))
 return key,{'compressed':'/'+str(target.relative_to(root)),'fallback':key,'width':image.width,'height':image.height,'encoding':'UASTC' if normal else 'ETC1S'}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:entries=dict(pool.map(convert,files))
manifest={'version':1,'textures':entries,'models':{}}
for folder in sorted((root/'models').iterdir()):
 if folder.is_dir():manifest['models'][folder.name]={'compressed':f'/models/{folder.name}/compressed.gltf','fallback':f'/models/{folder.name}/model.gltf'}
(root/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Compressed {len(entries)} textures with locally complete fallbacks.')
