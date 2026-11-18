import {readFile} from 'node:fs/promises';

// Both representations are part of the glTF 2.0 format. Keep byte-level
// assertions identical for embedded resources and external sidecars.
export function readBufferURI(uri,folder){
  const prefix='data:application/octet-stream;base64,';
  return uri.startsWith(prefix)?Buffer.from(uri.slice(prefix.length),'base64'):readFile(new URL(uri,folder));
}
