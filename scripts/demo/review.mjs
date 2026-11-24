// Checks the finished demo video: length, streams, voice gaps, and a contact sheet to look at.
// Usage: node scripts/demo/review.mjs   → demo-build/review/sheet-*.jpg + a printed report
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const video = path.join(root, 'client/public/demo/worklens-demo.mp4');
const out = path.join(root, 'demo-build/review');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
const runErr = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }); } catch (e) { return String(e.stderr ?? ''); } };

const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
const v = probe.streams.find((s) => s.codec_type === 'video'); const a = probe.streams.find((s) => s.codec_type === 'audio');
console.log(`file: ${(probe.format.size / 1048576).toFixed(1)} MB, ${(+probe.format.duration).toFixed(1)} s`);
console.log(`video: ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} fps, ${v.nb_frames} frames · audio: ${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch`);

// Voice gaps: silences inside the timeline vs. the scene plan (a silence longer than a scene break would show up here).
const sil = runErr('ffmpeg', ['-hide_banner', '-i', video, '-af', 'silencedetect=noise=-45dB:d=1.6', '-f', 'null', '-']);
const gaps = [...sil.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2], len: +m[3] }));
console.log(`silences ≥ 1.6 s: ${gaps.length ? gaps.map((g) => `${g.start.toFixed(1)}–${g.end.toFixed(1)} (${g.len.toFixed(1)} s)`).join(', ') : 'none'}`);

// Contact sheets: one frame every 3 s, 4×3 per sheet.
const step = 3; const dur = +probe.format.duration;
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=1/${step},scale=480:-1,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6,tile=4x3`, path.join(out, 'sheet-%02d.jpg')]);
console.log(`contact sheets: ${fs.readdirSync(out).filter((f) => f.startsWith('sheet')).length} (every ${step} s of ${dur.toFixed(0)} s) in demo-build/review/`);

// Stutter check from the capture timeline: longest gap between captured frames while something moved.
const tl = JSON.parse(fs.readFileSync(path.join(root, 'demo-build/timeline.json'), 'utf8'));
if (tl.maxMotionGap !== undefined) console.log(`longest gap between frames during motion: ${(tl.maxMotionGap * 1000).toFixed(0)} ms; frames captured: ${tl.framesCaptured}`);
console.log('scenes:', tl.scenes.map((s) => `${s.id}@${s.start}s`).join(' · '));
