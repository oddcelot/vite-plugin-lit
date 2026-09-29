# Iterating on the vite-plugin-lit promo

A 20s, 1920×1080 capabilities video. The whole thing plays inside a dark
Lit DevTools Timeline, and each capability is an event bar that opens into a demo
as the cyan playhead passes. Output: `renders/video.mp4`.

## Where things are

| File | What it holds |
| --- | --- |
| `BRIEF.md` | What the user asked for (message, length, look, silent) |
| `STORYBOARD.md` | Per-frame plan plus `## Video direction`, which holds the **STAGE SPEC** |
| `.hyperframes/stage-spec.md` | The STAGE SPEC copied out on its own. Frame packets don't include it, so workers need it passed separately |
| `frame.md` | Hand-written dark tokens from the `lit-design` skill. The preset remix came out light and is kept at `.hyperframes/frame.blue-professional.md` |
| `compositions/frames/NN-*.html` | One file per frame. Each frame redraws the whole stage |
| `renders/video.mp4` | The rendered v1 (committed) |
| `assets/bgm/brisk-feature-reveal.m4a` | Music bed "Brisk Feature Reveal", supplied by the user. The 19.84s original is padded with silence to 20.00s and re-encoded to AAC, so the assembler doesn't loop it to fill the gap |
| `audio_meta.json` | Hand-written; points the assembler at the bed (volume left at the default 0.9 for a film with no voice-over) |
| `assets/` | Manrope + Roboto Mono woff2 files and `flame.svg`, copied from `~/.claude/skills/lit-design` |

## The one rule that makes it work

Every frame draws the same chrome at the same pixels, and cuts between frames are
hard cuts. So the timeline has to be identical on both sides of every cut:

- Playhead: `x(tg) = 360 + 72·tg`, where tg is global time. It moves linearly and never eases.
- Frame starts: 0 · 2 · 6 · 9.5 · 12.5 · 14.5 · 17. To change a duration, shift every later start and every bar's `t0/t1` in the STAGE SPEC.
- Ruler: labels `top:628px`, 15px Roboto Mono, `line-height:18px`, `#616161`. Ticks `top:648px`, height 11, `#363636`. The first label reads `0ms`. Parallel workers got this wrong in 3 of 7 frames. Frame 02 is the reference.

**Check the cuts after any rebuild.** Snapshot 0.05s either side of each cut, crop
the ruler/track band, stack the crops and compare:

```sh
npx hyperframes snapshot --at 1.95,2.05,5.95,6.05,9.45,9.55,12.45,12.55,14.45,14.55,16.95,17.05
# then: ffmpeg crop=1920:120:0:600 per frame → vstack → look for label/tick/playhead jumps
```

## Commands

Run everything from this directory (`assets/promo-video/`). Its own
`package.json` shields `npx` from the repo root's pnpm-only `devEngines`; running
`npx hyperframes` from the repo root fails. The repo's `vp check` skips this
directory (see `ignorePatterns` in the root `vite.config.ts`).

Only the sources and `renders/video.mp4` are committed. `capture/`,
`snapshots/`, `.media/` and `.hyperframes/frame-packets/` are regenerated; see
`.gitignore`.

```sh
S=~/.claude/skills/product-launch-video/scripts
node $S/frame-packets.mjs --project "$PWD" --storyboard "$PWD/STORYBOARD.md"   # after STORYBOARD edits
node $S/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .         # after frame changes
npx hyperframes lint && npx hyperframes check
npx hyperframes preview --background                                            # Studio
npx hyperframes render --skill=product-launch-video --quality high --output renders/video.mp4
```

To rebuild a single frame: give a worker `_role.md`, its packet in
`.hyperframes/frame-packets/`, `frame.md` and `.hyperframes/stage-spec.md`. The
worker writes only its own `compositions/frames/NN-*.html`.

## Gotchas hit in v1

- Lint error `gsap_animates_clip_element`: don't tween `visibility`/`autoAlpha` on a `.clip` element. Use `opacity`.
- A frame's own background doesn't show after the first frame. The assembler paints `frame.md` → `colors.canvas` on the root instead, so keep that key.
- `npx hyperframes check` reports 7 `content_overlap` errors: stacked headline lines whose boxes touch because of the tight leading. The rendered frames show no overlap. Raise headline `line-height` if a clean check matters, then re-check the cuts.
- The count in frame 04 animates up to 42, so a paused frame can read 41.
- Not signed in to HeyGen, and the local Kokoro/MusicGen dependencies aren't installed. That's fine: the music is a supplied file and there is no voice-over.
- Keep STORYBOARD `music:` set to anything other than `none`. `music: none` without a SCRIPT.md makes `audio.mjs` treat the video as silent and delete `audio_meta.json`.
- Always pass `--audio-meta ./audio_meta.json` to `assemble-index.mjs`, or the bed is left out.
- Beats (`npx hyperframes beats .`): the tool reports 220 bpm, a beat every 0.273s starting at 0.15s. Every feature-bar hit lands within 10–100ms of a beat. The track dips at ~4.0s and ~8.0–8.5s and fades out from 18s. The final mix measures −16.8 LUFS.

## Ideas for next versions

- Snap hits exactly onto the beat grid in `beats/…json` (currently up to ±0.13s off), or add SFX on the bar hits.
- Cutdowns: a 1:1 or 9:16 version needs its own STAGE SPEC geometry; the timeline chrome won't fit as-is.
- A second film ("approach B" from the cap-demo notes): one clip per capability, with real playground footage in the stage area instead of rebuilt UI.
- Recipe: `lit-devtools-timeline` (v1). Say *"make another lit-devtools-timeline"* or *"like last time"* and the intent layer offers it before asking anything.
