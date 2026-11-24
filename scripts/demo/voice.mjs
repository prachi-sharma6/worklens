// Step 1 of the demo video: one voice clip per scene (edge-tts, Microsoft's neural "Ava" voice) + its subtitles,
// and each clip's exact length (ffprobe). The recorder paces every scene to its clip, so the voice never cuts off.
// Needs: python -m pip install edge-tts, ffmpeg/ffprobe on PATH.  Output: demo-build/voice/*.mp3|*.srt, voice.json
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(root, 'demo-build/voice');
fs.mkdirSync(out, { recursive: true });
const { voice, rate, scenes } = JSON.parse(fs.readFileSync(path.join(here, 'narration.json'), 'utf8'));

const durationOf = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

const clips = [];
for (const s of scenes) {
  const mp3 = path.join(out, `${s.id}.mp3`);
  const srt = path.join(out, `${s.id}.srt`);
  const txt = path.join(out, `${s.id}.txt`);
  fs.writeFileSync(txt, s.text);
  const keyFile = path.join(out, `${s.id}.key`);
  const key = `${voice}|${rate}|${s.text}`;
  const fresh = fs.existsSync(mp3) && fs.statSync(mp3).size > 0 && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key;
  if (!fresh) {
    // The voice service drops a connection now and then: retry, and never accept an empty clip.
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync('python', ['-m', 'edge_tts', '--voice', voice, `--rate=${rate}`, '--file', txt, '--write-media', mp3, '--write-subtitles', srt], { stdio: 'pipe' });
        if (fs.statSync(mp3).size > 0) break;
      } catch (e) { if (attempt >= 5) throw new Error(`voice for ${s.id} failed 5 times: ${String(e.stderr ?? e.message).split('\n').filter(Boolean).pop()}`); }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    fs.writeFileSync(keyFile, key);
  }
  clips.push({ id: s.id, file: mp3, srt, duration: durationOf(mp3), text: s.text });
}
fs.writeFileSync(path.join(root, 'demo-build/voice.json'), JSON.stringify(clips, null, 2));
const total = clips.reduce((a, c) => a + c.duration, 0);
for (const c of clips) console.log(`${c.id.padEnd(18)} ${c.duration.toFixed(2)}s`);
console.log(`narration total ${total.toFixed(1)}s`);
