#!/usr/bin/env bash
set -euo pipefail
ffmpeg -hide_banner -loglevel warning -y -f concat -safe 0 -i /tmp/homestead-gameplay-frames/frames.txt -vf 'fps=20,format=yuv420p' -c:v libx264 -crf 19 -preset medium -movflags +faststart /workspace/homestead-gameplay.mp4
ffmpeg -hide_banner -loglevel warning -y -ss 8.5 -i /workspace/homestead-gameplay.mp4 -frames:v 1 -update 1 /workspace/homestead-gameplay-poster.jpg
ffmpeg -hide_banner -loglevel warning -y -ss 8 -t 4 -i /workspace/homestead-gameplay.mp4 -filter_complex '[0:v]fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' /workspace/homestead-gameplay-preview.gif
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of json /workspace/homestead-gameplay.mp4
