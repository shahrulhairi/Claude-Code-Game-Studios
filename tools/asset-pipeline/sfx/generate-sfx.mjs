#!/usr/bin/env node
/**
 * generate-sfx.mjs — render retro sound effects to WAV with jsfxr.
 *
 * Reads a sound bank (sfx-bank.json by default) and writes one WAV per sound
 * (or per variant), plus sfx-manifest.json recording the exact parameters,
 * the sfxr.me share code, and a link to open each sound in the sfxr.me editor.
 *
 * Every preset roll is seeded, so the same bank produces byte-identical WAVs
 * on every run and machine. Change a seed to get a different take.
 *
 * Usage: see README.md, or run `node generate-sfx.mjs --help`.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const jsfxr = require("jsfxr");
const { sfxr, Params } = jsfxr;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const DEFAULT_BANK = path.join(SCRIPT_DIR, "sfx-bank.json");
const DEFAULT_OUT = path.join(REPO_ROOT, "assets", "audio", "sfx");

/** jsfxr preset generators, mapped to the names used in sfxr.me's buttons. */
export const PRESETS = [
  "pickupCoin",
  "laserShoot",
  "explosion",
  "powerUp",
  "hitHurt",
  "jump",
  "blipSelect",
  "synth",
  "tone",
  "click",
  "random",
];

/** Engine-friendly defaults: 16-bit PCM, 44.1 kHz, mono. */
export const DEFAULT_SAMPLE_SETTINGS = {
  sample_rate: 44100,
  sample_size: 16,
  sound_vol: 0.25,
};

const NAME_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Deterministic PRNG (mulberry32). Returns a function shaped like Math.random.
 * @param {number} seed 32-bit integer seed
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive the seed for variant `index` of a sound. Variant 0 uses the base seed
 * unchanged so a single-variant entry and the first of many sound the same.
 */
export function variantSeed(seed, index) {
  if (index === 0) return seed >>> 0;
  return (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(index, 40503)) >>> 0;
}

/**
 * Run `fn` with Math.random replaced by a seeded PRNG. jsfxr uses Math.random
 * both for preset rolls and for the noise waveform, so both steps run inside.
 */
function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/**
 * Build the jsfxr Params for one bank entry (one variant).
 * @param {object} entry   bank entry: { preset, seed, params } | { b58, params } | { params }
 * @param {object} sample  sample settings: { sample_rate, sample_size, sound_vol }
 * @param {number} seed    seed for this variant
 * @returns {Params}
 */
export function buildParams(entry, sample, seed) {
  let p;
  if (entry.b58) {
    p = new Params().fromB58(entry.b58);
  } else if (entry.preset) {
    if (!PRESETS.includes(entry.preset)) {
      throw new Error(`unknown preset "${entry.preset}" (known: ${PRESETS.join(", ")})`);
    }
    p = new Params();
    p[entry.preset]();
  } else {
    p = new Params();
  }
  if (entry.params) p.fromJSON(entry.params);
  // Sample settings are not part of the sfxr.me share code; apply them last.
  p.sample_rate = sample.sample_rate;
  p.sample_size = sample.sample_size;
  p.sound_vol = sample.sound_vol;
  return p;
}

/**
 * Render one bank entry into WAV buffers, one per variant.
 * @param {object} entry     bank entry (see README.md for the schema)
 * @param {object} defaults  bank-level sample settings
 * @returns {{file: string, wav: Buffer, meta: object}[]}
 */
export function renderEntry(entry, defaults = {}) {
  if (!entry || typeof entry.name !== "string" || !NAME_RE.test(entry.name)) {
    throw new Error(`invalid sound name ${JSON.stringify(entry && entry.name)}: use letters, digits, _ or -`);
  }
  if (!entry.preset && !entry.b58 && !entry.params) {
    throw new Error(`sound "${entry.name}" needs one of: preset, b58, params`);
  }
  const sample = { ...DEFAULT_SAMPLE_SETTINGS, ...defaults, ...(entry.sample || {}) };
  if (![8, 16].includes(sample.sample_size)) {
    throw new Error(`sound "${entry.name}": sample_size must be 8 or 16`);
  }
  const variants = Math.max(1, Math.floor(entry.variants || 1));
  const baseSeed = Number.isInteger(entry.seed) ? entry.seed : 1;
  const out = [];

  for (let i = 0; i < variants; i++) {
    const seed = variantSeed(baseSeed, i);
    const result = withSeed(seed, () => {
      const params = buildParams(entry, sample, seed);
      const wave = sfxr.toWave(params);
      return { params, wave };
    });
    const { params, wave } = result;
    const file = variants > 1 ? `${entry.name}_${String(i + 1).padStart(2, "0")}.wav` : `${entry.name}.wav`;
    const b58 = params.toB58();
    const bytesPerSample = sample.sample_size / 8;
    const dataBytes = wave.wav.length - 44;
    out.push({
      file,
      wav: Buffer.from(wave.wav),
      meta: {
        file,
        name: entry.name,
        variant: i + 1,
        source: entry.b58 ? "b58" : entry.preset ? `preset:${entry.preset}` : "params",
        seed: entry.b58 ? null : seed,
        duration_s: Number((dataBytes / bytesPerSample / sample.sample_rate).toFixed(3)),
        clipped_samples: wave.clipping,
        sample_rate: sample.sample_rate,
        sample_size: sample.sample_size,
        b58,
        sfxr_url: `https://sfxr.me/#${b58}`,
      },
    });
  }
  return out;
}

function parseArgs(argv) {
  const args = { only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "-h": case "--help": args.help = true; break;
      case "--list": args.list = true; break;
      case "--bank": args.bank = next(); break;
      case "--out": args.out = next(); break;
      case "--only": args.only = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--preset": args.preset = next(); break;
      case "--b58": args.b58 = next(); break;
      case "--name": args.name = next(); break;
      case "--seed": args.seed = parseInt(next(), 10); break;
      case "--variants": args.variants = parseInt(next(), 10); break;
      case "--sample-rate": args.sample_rate = parseInt(next(), 10); break;
      case "--sample-size": args.sample_size = parseInt(next(), 10); break;
      case "--volume": args.sound_vol = parseFloat(next()); break;
      default: throw new Error(`unknown argument "${a}" (try --help)`);
    }
  }
  return args;
}

const HELP = `generate-sfx — render jsfxr sound effects to WAV

  node generate-sfx.mjs [--bank FILE] [--out DIR] [--only a,b]
  node generate-sfx.mjs --preset jump --seed 7 [--name my_jump] [--variants 3]
  node generate-sfx.mjs --b58 <code from sfxr.me> --name my_sound
  node generate-sfx.mjs --list

  --bank FILE        sound bank JSON (default: sfx-bank.json beside this script)
  --out DIR          output folder (default: <repo>/assets/audio/sfx)
  --only a,b         render only these bank entries
  --preset NAME      one-off sound from a preset (skips the bank)
  --b58 CODE         one-off sound from an sfxr.me share code (skips the bank)
  --name NAME        file name for a one-off sound
  --seed N           seed for a preset roll (default 1)
  --variants N       how many takes to render
  --sample-rate HZ   default 44100
  --sample-size 8|16 default 16 (use 16 for Unreal, Unity and Godot)
  --volume 0..1      default 0.25
  --list             print the preset names
`;

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  if (args.list) { process.stdout.write(PRESETS.join("\n") + "\n"); return 0; }

  const cliSample = {};
  for (const k of ["sample_rate", "sample_size", "sound_vol"]) {
    if (args[k] !== undefined && !Number.isNaN(args[k])) cliSample[k] = args[k];
  }

  let defaults;
  let sounds;
  if (args.preset || args.b58) {
    defaults = cliSample;
    sounds = [{
      name: args.name || args.preset || "sfx",
      preset: args.preset,
      b58: args.b58,
      seed: Number.isInteger(args.seed) ? args.seed : 1,
      variants: args.variants,
    }];
  } else {
    const bankPath = path.resolve(args.bank || DEFAULT_BANK);
    const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
    defaults = { ...(bank.defaults || {}), ...cliSample };
    sounds = bank.sounds || [];
    if (args.only) {
      const missing = args.only.filter((n) => !sounds.some((s) => s.name === n));
      if (missing.length) throw new Error(`not in bank: ${missing.join(", ")}`);
      sounds = sounds.filter((s) => args.only.includes(s.name));
    }
  }

  const outDir = path.resolve(args.out || DEFAULT_OUT);
  fs.mkdirSync(outDir, { recursive: true });

  const manifestPath = path.join(outDir, "sfx-manifest.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")).sounds || {}; } catch { manifest = {}; }
  }

  let count = 0;
  for (const entry of sounds) {
    for (const { file, wav, meta } of renderEntry(entry, defaults)) {
      fs.writeFileSync(path.join(outDir, file), wav);
      manifest[file] = meta;
      const clip = meta.clipped_samples ? `  (${meta.clipped_samples} clipped samples, lower --volume)` : "";
      process.stdout.write(`  ${file.padEnd(28)} ${meta.duration_s.toFixed(2)}s  ${meta.source}${clip}\n`);
      count++;
    }
  }

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(manifestPath, JSON.stringify({ generator: "jsfxr@1.4.1", sounds: sorted }, null, 2) + "\n");
  process.stdout.write(`Wrote ${count} WAV file(s) to ${outDir}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`generate-sfx: ${err.message}\n`);
    process.exitCode = 1;
  }
}
