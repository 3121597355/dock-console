'use strict';

/**
 * Whole-machine power.
 *
 * Three sources, in descending order of trustworthiness — the chosen one is
 * reported as `source` so the UI can label the number honestly:
 *
 *   1. battery  — voltage × amperage while discharging. This is the machine's
 *                 real draw, not an estimate. Available on macOS and on most
 *                 Linux laptops.
 *   2. rapl     — CPU package energy counter (Intel RAPL / AMD via powercap).
 *                 Real CPU wattage; the rest of the system is modelled.
 *   3. model    —  base + CPU% × PL1 + measured GPU + disk throughput.
 *                 The only option on Windows, where no AC power telemetry is
 *                 exposed to user space at all.
 *
 *   P ≈ baseW + (cpuIdleW + cpu% × cpuMaxW) + GPU(measured) + disk throughput
 */
function createPowerModel(cfg, caps) {
  const p = { baseW: 8, cpuIdleW: 4, cpuMaxW: 45, diskWPerMBs: 0.6, ...(cfg.power || {}) };
  const gpuReal = !!(caps && (caps.gpuPower || caps.gpuSmi));

  function compute(m) {
    if (p.enabled === false) {
      return {
        total: 0, cpuPart: 0, gpuPart: 0, basePart: 0, diskPart: 0,
        enabled: false, gpuReal, source: 'off', estimated: true,
      };
    }

    const gpuW = m.gpuW == null ? 0 : m.gpuW;
    const diskW = (((m.diskR || 0) + (m.diskW || 0)) / 1e6) * p.diskWPerMBs;

    // 1. measured system draw
    if (m.battW != null && m.battW > 0) {
      const total = m.battW;
      const cpuPart = m.cpuPackageW != null ? m.cpuPackageW : 0;
      const rest = Math.max(0, total - gpuW - cpuPart);
      return {
        total: +total.toFixed(1),
        cpuPart: +cpuPart.toFixed(1),
        gpuPart: +gpuW.toFixed(1),
        basePart: +rest.toFixed(1),
        diskPart: 0,
        enabled: true,
        gpuReal,
        source: 'battery',
        estimated: false,
      };
    }

    // 2. measured CPU package power + modelled remainder
    if (m.cpuPackageW != null && m.cpuPackageW > 0) {
      const cpuW = m.cpuPackageW;
      const total = p.baseW + cpuW + gpuW + diskW;
      return {
        total: +total.toFixed(1),
        cpuPart: +cpuW.toFixed(2),
        gpuPart: +gpuW.toFixed(1),
        basePart: +p.baseW.toFixed(1),
        diskPart: +diskW.toFixed(1),
        enabled: true,
        gpuReal,
        source: 'rapl',
        estimated: false,
      };
    }

    // 3. estimate
    const cpuPct = Math.min(100, Math.max(0, m.cpu || 0));
    const cpuW = p.cpuIdleW + (cpuPct / 100) * p.cpuMaxW;
    const total = p.baseW + cpuW + gpuW + diskW;
    return {
      total: +total.toFixed(1),
      cpuPart: +cpuW.toFixed(1),
      gpuPart: +gpuW.toFixed(1),
      basePart: +p.baseW.toFixed(1),
      diskPart: +diskW.toFixed(1),
      enabled: true,
      gpuReal,
      source: 'model',
      estimated: true,
    };
  }

  return { compute, params: p, gpuReal };
}

module.exports = { createPowerModel };
