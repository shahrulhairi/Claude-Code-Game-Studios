// Unit tests for generate-sfx.mjs. Run: npm test (from tools/asset-pipeline/sfx).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderEntry, mulberry32, variantSeed, PRESETS } from "../generate-sfx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK = JSON.parse(fs.readFileSync(path.join(HERE, "..", "sfx-bank.json"), "utf8"));

function readHeader(buf) {
  return {
    riff: buf.toString("ascii", 0, 4),
    wave: buf.toString("ascii", 8, 12),
    format: buf.readUInt16LE(20),
    channels: buf.readUInt16LE(22),
    sampleRate: buf.readUInt32LE(24),
    bitsPerSample: buf.readUInt16LE(34),
    dataTag: buf.toString("ascii", 36, 40),
    dataSize: buf.readUInt32LE(40),
  };
}

test("seeded PRNG is deterministic", () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test("variant 0 keeps the base seed; later variants differ", () => {
  assert.equal(variantSeed(101, 0), 101);
  assert.notEqual(variantSeed(101, 1), 101);
  assert.notEqual(variantSeed(101, 1), variantSeed(101, 2));
});

test("same entry renders byte-identical WAVs (including noise-based explosion)", () => {
  for (const preset of ["jump", "explosion"]) {
    const entry = { name: "t", preset, seed: 9 };
    const [a] = renderEntry(entry);
    const [b] = renderEntry(entry);
    assert.ok(a.wav.equals(b.wav), `${preset} not deterministic`);
  }
});

test("different seeds give different sounds", () => {
  const [a] = renderEntry({ name: "t", preset: "laserShoot", seed: 1 });
  const [b] = renderEntry({ name: "t", preset: "laserShoot", seed: 2 });
  assert.notEqual(a.meta.b58, b.meta.b58);
});

test("output is 16-bit mono 44.1 kHz PCM by default", () => {
  const [{ wav }] = renderEntry({ name: "t", preset: "pickupCoin", seed: 3 });
  const h = readHeader(wav);
  assert.equal(h.riff, "RIFF");
  assert.equal(h.wave, "WAVE");
  assert.equal(h.format, 1);
  assert.equal(h.channels, 1);
  assert.equal(h.sampleRate, 44100);
  assert.equal(h.bitsPerSample, 16);
  assert.equal(h.dataTag, "data");
  assert.equal(h.dataSize, wav.length - 44);
  assert.ok(h.dataSize > 0);
});

test("variants produce numbered files", () => {
  const out = renderEntry({ name: "hit", preset: "hitHurt", seed: 5, variants: 3 });
  assert.deepEqual(out.map((o) => o.file), ["hit_01.wav", "hit_02.wav", "hit_03.wav"]);
});

test("params override the preset roll", () => {
  const [{ meta }] = renderEntry({ name: "t", preset: "jump", seed: 5, params: { wave_type: 2 } });
  const [{ meta: base }] = renderEntry({ name: "t", preset: "jump", seed: 5 });
  assert.notEqual(meta.b58, base.b58);
});

test("b58 share code round-trips", () => {
  const [{ meta }] = renderEntry({ name: "t", preset: "powerUp", seed: 8 });
  const [{ meta: again }] = renderEntry({ name: "t2", b58: meta.b58 });
  assert.equal(again.b58, meta.b58);
});

test("rejects unsafe names and unknown presets", () => {
  assert.throws(() => renderEntry({ name: "../evil", preset: "jump" }), /invalid sound name/);
  assert.throws(() => renderEntry({ name: "x", preset: "nope" }), /unknown preset/);
  assert.throws(() => renderEntry({ name: "x" }), /needs one of/);
});

test("every entry in the shipped bank renders", () => {
  for (const entry of BANK.sounds) {
    const out = renderEntry(entry, BANK.defaults);
    assert.ok(out.length >= 1, entry.name);
    for (const o of out) assert.ok(o.wav.length > 44, o.file);
  }
  for (const s of BANK.sounds) if (s.preset) assert.ok(PRESETS.includes(s.preset), s.preset);
});
