# SFX pipeline (jsfxr)

Generates retro game sound effects (jump, coin, hit, explosion, laser,
power-up, UI blips) as WAV files from [jsfxr](https://github.com/chr15m/jsfxr)
presets and parameters. Sounds are described in a JSON sound bank, so they are
versioned, reviewable, and reproducible: the same bank renders byte-identical
WAVs on every machine.

## Quick start

Requires Node.js 18+.

```bash
cd tools/asset-pipeline/sfx
npm install
npm run generate          # renders every sound in sfx-bank.json
```

WAVs land in `assets/audio/sfx/` at the repo root, next to `sfx-manifest.json`.

| Command | What it does |
|---|---|
| `npm run generate` | Render the whole bank |
| `node generate-sfx.mjs --only jump,coin` | Render only some entries |
| `node generate-sfx.mjs --preset laserShoot --seed 12 --variants 5 --name zap` | One-off sound, no bank edit |
| `node generate-sfx.mjs --b58 <code> --name my_sound` | Render a sound designed on sfxr.me |
| `node generate-sfx.mjs --out <dir>` | Write somewhere else (e.g. straight into a Unity/Godot folder) |
| `npm run list` | List preset names |
| `npm test` | Run the unit tests |

Other flags: `--bank FILE`, `--sample-rate HZ` (default 44100),
`--sample-size 8|16` (default 16), `--volume 0..1` (default 0.25). Run
`node generate-sfx.mjs --help` for the full list.

## The sound bank

`sfx-bank.json` lists sounds. Each entry needs a `name` (letters, digits, `_`,
`-`) and one source:

```json
{
  "defaults": { "sample_rate": 44100, "sample_size": 16, "sound_vol": 0.25 },
  "sounds": [
    { "name": "jump", "preset": "jump", "seed": 101, "variants": 3 },
    { "name": "jump_heavy", "preset": "jump", "seed": 101,
      "params": { "p_base_freq": 0.22, "p_env_decay": 0.35 } },
    { "name": "door", "b58": "<share code copied from sfxr.me>" },
    { "name": "beep", "params": { "wave_type": 2, "p_base_freq": 0.5, "p_env_decay": 0.2 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `preset` | `pickupCoin`, `laserShoot`, `explosion`, `powerUp`, `hitHurt`, `jump`, `blipSelect`, `synth`, `tone`, `click`, `random` |
| `seed` | Integer. The preset roll is random; the seed fixes it. Change it for a different take. |
| `variants` | Render N takes as `name_01.wav` ... `name_NN.wav`, for random-pick playback so repeats don't sound identical. |
| `params` | jsfxr parameters, applied on top of the preset or share code. Names and ranges: the `Params` block at the top of `node_modules/jsfxr/sfxr.js`. |
| `b58` | The code after `#` in an sfxr.me share URL. |
| `sample` | Per-sound override of `sample_rate` / `sample_size` / `sound_vol`. |

## Tweaking a sound by ear

`sfx-manifest.json` records, for every WAV, its seed, its share code (`b58`) and
an `sfxr_url`. Open the URL in a browser to hear the sound in the sfxr.me
editor and tweak its sliders, then copy the new share code back into the bank
as a `b58` entry.

If the generator reports clipped samples, lower `sound_vol` for that sound.

## Importing into an engine

Output is mono 16-bit PCM WAV at 44.1 kHz, which all three engines import as-is.

**Unreal Engine 5**

- Manual: drag the WAVs into the Content Browser (e.g. `/Game/Audio/SFX`).
  Each becomes a SoundWave. Use a Sound Cue (Random node) or MetaSound to pick
  between `_01` / `_02` / `_03` variants.
- Scripted: with the Python Editor Script Plugin enabled, run
  `import_to_unreal.py` from the Output Log (Python mode):

  ```text
  py "C:/path/to/repo/tools/asset-pipeline/sfx/import_to_unreal.py" --src "C:/path/to/repo/assets/audio/sfx" --dest /Game/Audio/SFX
  ```

  Re-running replaces existing assets, so regenerate then re-import to update.
  With UnrealClaude, set `SRC_DIR` at the top of the script and run it through
  the `execute_script` tool with `script_type: "python"`.
- Keep the WAVs outside `Content/`; Unreal stores the imported `.uasset` there
  and remembers the source path for reimport.

**Godot 4** — generate into the project (`--out assets/audio/sfx` is already
inside `res://`). The editor auto-imports WAVs as `AudioStreamWAV`.

**Unity** — generate into `Assets/Audio/SFX` (`--out <project>/Assets/Audio/SFX`).
Unity imports them as AudioClips. For short SFX, set Load Type to
*Decompress On Load*.

## Licence

jsfxr is public domain ([Unlicense](https://github.com/chr15m/jsfxr/blob/master/UNLICENSE)),
and sounds you generate with it are yours.
