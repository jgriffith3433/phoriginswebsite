#!/bin/bash
# v6: re-cut of the final locally: lipsynced hook, clean floor digits, harder vat burst.
set -e
cd "$(dirname "$0")"; mkdir -p out/v6; O=out/v6
OLD=out/final/video-compose-a_eac3a9ee2f65b910-cut.mp4
LIP=t6/video-upscale-934500155-Save_Video.mp4
BUR=t6/video-upscale-841171057-Save_Video.mp4
N="scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=24,setsar=1,format=yuv420p"
enc="-an -c:v libx264 -crf 16 -preset medium -pix_fmt yuv420p"
ffmpeg -loglevel error -y -i $LIP -t 3.56 -vf "$N" $enc $O/a.mp4
ffmpeg -loglevel error -y -ss 3.56 -t 16.99 -i $OLD -vf "$N" $enc $O/b.mp4
rm -f $O/fl.txt; for f in f58 f30 fb1 fb3; do cat >> $O/fl.txt <<<"file '../../floors/$f.mp4'"; done
ffmpeg -loglevel error -y -f concat -safe 0 -i $O/fl.txt -vf "$N" $enc $O/c.mp4
ffmpeg -loglevel error -y -ss 23.56 -t 6.2 -i $OLD -vf "$N" $enc $O/d.mp4
ffmpeg -loglevel error -y -t 0.5 -i $BUR -vf "$N" $enc $O/e1.mp4
ffmpeg -loglevel error -y -ss 30.26 -t 2.56 -i $OLD -vf "$N" $enc $O/e2.mp4
ffmpeg -loglevel error -y -ss 32.82 -i $OLD -vf "$N" $enc $O/f.mp4
rm -f $O/list.txt; for p in a b c d e1 e2 f; do echo "file '$p.mp4'" >> $O/list.txt; done
ffmpeg -loglevel error -y -f concat -safe 0 -i $O/list.txt -c copy $O/video.mp4
# audio
S=sfx/audio-sfx-a_; V=audio/audio-voice-a_
ffmpeg -loglevel error -y \
 -i ${V}5c5ba5e2c4f76517.mp3 -i ${S}5c960121c940ed93.mp3 -i ${S}7a80203ef3029880.mp3 -i ${S}3205fb12ce4054a3.mp3 \
 -i ${S}6789a8af4e7ff827.mp3 -i ${S}aaffe35f7e9aa4a6.mp3 -i ${S}f346e91a6e59858c.mp3 -i ${V}cae27c17bafed2d8.mp3 \
 -filter_complex "\
[0]volume=1.2,adelay=0|0[a0];\
[1]atrim=0:3,volume=0.9,adelay=3560|3560[a1];\
[1]atrim=0:0.7,volume=0.7,adelay=6560|6560[a2];\
[2]atrim=0:6.06,volume=0.7,adelay=17500|17500[a3];\
[2]atrim=0:3.06,volume=0.6,adelay=20500|20500[a4];\
[3]atrim=0:6.06,volume=0.35,adelay=17500|17500[a5];\
[4]atrim=0:5,volume=0.8,adelay=23560|23560[a6];\
[5]atrim=0:3,volume=0.9,adelay=29760|29760[a7];\
[6]atrim=0:3,volume=1.0,adelay=29760|29760[a8];\
[7]volume=1.2,adelay=33020|33020[a9];\
[a0][a1][a2][a3][a4][a5][a6][a7][a8][a9]amix=inputs=10:normalize=0,alimiter=limit=0.95[m]" \
 -map "[m]" -t 39.84 $O/audio.wav
ffmpeg -loglevel error -y -i $O/video.mp4 -i $O/audio.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest $O/nocard.mp4
ffmpeg -loglevel error -y -i $O/nocard.mp4 -i card/endcard.mp4 -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v];[0:a]apad=pad_dur=1.6[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest out/cut_v6.mp4
ffmpeg -loglevel error -y -ss 1 -i out/cut_v6.mp4 -frames:v 1 out/poster_v6.png
