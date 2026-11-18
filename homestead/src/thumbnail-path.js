// These two packaged previews embed their WebP render in a standalone SVG.
export const thumbnailPath=id=>`/thumbnails/${id}.${id==='chair'||id==='sink'?'svg':'webp'}`;
