'use strict';
const assert = require('assert');
const { createPowerModel } = require('../src/power');

const CFG = { power: { baseW: 8, cpuIdleW: 4, cpuMaxW: 45, diskWPerMBs: 0.6 } };
const CAPS = { gpuPower: true };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('falls back to the load model when nothing is measured', () => {
  const p = createPowerModel(CFG, CAPS).compute({ cpu: 50, gpuW: 10, diskR: 0, diskW: 0 });
  assert.strictEqual(p.source, 'model');
  assert.strictEqual(p.estimated, true);
  assert.strictEqual(p.cpuPart, 26.5); // 4 + 50% × 45
  assert.strictEqual(p.total, 44.5); // 8 + 26.5 + 10
});

test('battery discharge wins and is marked as measured', () => {
  const p = createPowerModel(CFG, CAPS).compute({ cpu: 90, gpuW: 10, battW: 12.4 });
  assert.strictEqual(p.source, 'battery');
  assert.strictEqual(p.estimated, false);
  assert.strictEqual(p.total, 12.4);
  assert.strictEqual(p.gpuPart, 10);
  // remainder of a measured total lands in the baseline bucket
  assert.strictEqual(p.basePart, 2.4);
});

test('RAPL beats the model but stays labelled estimated overall', () => {
  const p = createPowerModel(CFG, CAPS).compute({ cpu: 100, cpuPackageW: 15.2, gpuW: 0 });
  assert.strictEqual(p.source, 'rapl');
  assert.strictEqual(p.estimated, false);
  assert.strictEqual(p.cpuPart, 15.2);
  assert.strictEqual(p.total, 23.2); // 8 + 15.2
});

test('zero battery wattage does not hijack the model', () => {
  const p = createPowerModel(CFG, CAPS).compute({ cpu: 10, gpuW: 0, battW: 0 });
  assert.strictEqual(p.source, 'model');
});

test('--no-power disables the panel instead of reporting zero', () => {
  const p = createPowerModel({ power: { enabled: false } }, CAPS).compute({ cpu: 50 });
  assert.strictEqual(p.enabled, false);
  assert.strictEqual(p.source, 'off');
});

test('GPU layer is reported unavailable without nvidia-smi', () => {
  const p = createPowerModel(CFG, { gpuPower: false }).compute({ cpu: 10 });
  assert.strictEqual(p.gpuReal, false);
  assert.strictEqual(p.gpuPart, 0);
});

module.exports = { name: 'power source priority', tests };
