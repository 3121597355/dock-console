'use strict';

/* ============================================================ state */
const S = {
  model: null,
  m: {},
  power: null,
  caps: {},
  history: [],
  events: [],
  energyWh: 0,
  sources: {},
  host: null,
  battery: null,
  hoverIdx: null,
  hoverX: 0,
  connected: false,
};

const T = (k, p) => I18N.t(k, p);
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/* ============================================================ canvas util */
function fit(canvas, cssHeight) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const h = cssHeight || canvas.clientHeight || 200;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/* ============================================================ power chart */
const chartCv = $('powerChart');
const tipEl = $('powerTip');
const WINDOW_S = 300;

function niceStep(v) {
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 100) * 100;
}

/* 3-point median: removes single-sample glitches, keeps sustained load */
function med3(arr) {
  if (arr.length < 3) return arr.slice();
  const out = arr.slice();
  for (let i = 1; i < arr.length - 1; i++) {
    const a = arr[i - 1], b = arr[i], c = arr[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

function drawPower() {
  const { ctx, w, h } = fit(chartCv, 246);
  const padL = 36, padR = 14, padT = 12, padB = 20;
  const plotW = Math.max(10, w - padL - padR);
  const plotH = Math.max(10, h - padT - padB);
  const now = Date.now();

  const hist = S.history;
  let win = WINDOW_S;
  if (hist.length > 1) {
    const span = (now - hist[0].t) / 1000;
    win = Math.min(WINDOW_S, Math.max(60, span + 4));
  }
  const winLabel = $('winLabel');
  if (winLabel) winLabel.textContent = T('power.win', { n: Math.max(1, Math.round(win / 60)) });

  const raw = hist.filter((p) => now - p.t <= win * 1000 + 1500);
  const smoothPeak = Math.max(...med3(raw.map((p) => p.p || 0)), 0);
  const step = niceStep(Math.max(smoothPeak, 10) / 4);
  const maxV = step * 4;
  const pts = raw.map((p) => ({ t: p.t, p: p.p || 0, pc: p.pc || 0, pg: p.pg || 0 }));

  ctx.font = '10px "Cascadia Mono", Consolas, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.strokeStyle = i === 4 ? '#1e2b3a' : 'rgba(30,43,58,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, Math.round(y) + 0.5);
    ctx.lineTo(padL + plotW, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = '#5f7085';
    ctx.textAlign = 'right';
    ctx.fillText((maxV - step * i).toFixed(0), padL - 8, y);
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#4b5b6e';
  const tickSteps = [10, 15, 30, 60, 120, 300];
  const st = tickSteps.find((s) => s >= win / 5) || 300;
  for (let off = 0; off <= win; off += st) {
    const x = padL + plotW - (off / win) * plotW;
    const label = off === 0 ? T('power.now') : st >= 60 ? `-${Math.round(off / 60)}m` : `-${off}s`;
    ctx.fillText(label, Math.min(padL + plotW - 12, Math.max(padL + 12, x)), h - 8);
  }

  if (pts.length < 2) {
    ctx.fillStyle = '#3f4f61';
    ctx.textAlign = 'center';
    ctx.fillText(T('power.collecting'), padL + plotW / 2, padT + plotH / 2);
    return;
  }

  const xOf = (t) => padL + plotW - ((now - t) / (win * 1000)) * plotW;
  const yOf = (v) => padT + plotH - (v / maxV) * plotH;

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT - 1, plotW, plotH + 2);
  ctx.clip();

  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, 'rgba(47,227,160,0.30)');
  grad.addColorStop(0.55, 'rgba(47,227,160,0.10)');
  grad.addColorStop(1, 'rgba(47,227,160,0.005)');
  ctx.beginPath();
  ctx.moveTo(xOf(pts[0].t), padT + plotH);
  for (const p of pts) ctx.lineTo(xOf(p.t), yOf(p.p));
  ctx.lineTo(xOf(pts[pts.length - 1].t), padT + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const line = (key, color, width) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xOf(p.t);
      const y = yOf(p[key] || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  line('p', '#2fe3a0', 1.9);
  line('pc', 'rgba(76,141,255,0.85)', 1.2);
  if (!S.power || S.power.gpuReal !== false) line('pg', 'rgba(167,139,250,0.85)', 1.2);
  ctx.restore();

  if (S.hoverIdx != null && pts.length) {
    const i = Math.max(0, Math.min(pts.length - 1, S.hoverIdx));
    const p = pts[i];
    const x = xOf(p.t);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, padT);
    ctx.lineTo(Math.round(x) + 0.5, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    const dots = [
      [p.p, '#2fe3a0'],
      [p.pc, '#4c8dff'],
      [p.pg, '#a78bfa'],
    ];
    for (const [v, c] of dots) {
      ctx.beginPath();
      ctx.arc(x, yOf(v), 2.6, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.strokeStyle = '#070a0f';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    tipEl.innerHTML =
      `<div class="tip-t">${hhmmss(p.t)}</div>` +
      `<div class="tip-r"><i style="background:#2fe3a0"></i><span>${T('tip.total')}</span><b>${fmt(p.p)} W</b></div>` +
      `<div class="tip-r"><i style="background:#4c8dff"></i><span>${T('tip.cpu')}</span><b>${fmt(p.pc)} W</b></div>` +
      `<div class="tip-r"><i style="background:#a78bfa"></i><span>${T('tip.gpu')}</span><b>${fmt(p.pg)} W</b></div>`;
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${padT + 6}px`;
    tipEl.classList.add('show');
  } else {
    tipEl.classList.remove('show');
  }
}

(function bindHover() {
  chartCv.addEventListener('mousemove', (e) => {
    const rect = chartCv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padL = 36, padR = 14;
    const plotW = rect.width - padL - padR;
    const now = Date.now();
    const pts = S.history.filter((p) => now - p.t <= WINDOW_S * 1000 + 1200);
    if (!pts.length) return;
    const ratio = 1 - (x - padL) / plotW;
    const t = now - ratio * WINDOW_S * 1000;
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bestD) { bestD = d; best = i; }
    });
    S.hoverIdx = best;
  });
  chartCv.addEventListener('mouseleave', () => {
    S.hoverIdx = null;
    tipEl.classList.remove('show');
    drawPower();
  });
})();

/* ============================================================ sparkline */
function drawSpark(canvas, values, color) {
  const { ctx, w, h } = fit(canvas, 40);
  if (values.length < 2) return;
  const sorted = values.slice().sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || sorted[sorted.length - 1];
  const max = Math.max(p90 * 1.25, sorted[sorted.length - 1] * 0.6, 1);
  const xOf = (i) => (i / (values.length - 1)) * w;
  const yOf = (v) => h - 4 - (Math.min(v, max) / max) * (h - 12);

  ctx.beginPath();
  ctx.moveTo(0, h);
  values.forEach((v, i) => ctx.lineTo(xOf(i), yOf(v)));
  ctx.lineTo(w, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(47,227,160,0.26)');
  g.addColorStop(1, 'rgba(47,227,160,0.01)');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => (i === 0 ? ctx.moveTo(xOf(i), yOf(v)) : ctx.lineTo(xOf(i), yOf(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/* ============================================================ icons */
function iconFor(d) {
  const n = `${d.name || ''} ${d.desc || ''}`.toLowerCase();
  if (d.isHub) return 'ic-hub';
  if (d.cls === 'Camera' || /camera|摄像/.test(n)) return 'ic-camera';
  if (d.disk || d.cls === 'DiskDrive' || d.cls === 'SCSIAdapter' || /ssd|hdd|elements|存储|硬盘/.test(n)) return 'ic-disk';
  if (d.cls === 'WPD' || /matepad|phone|android|iphone|平板/.test(n)) return 'ic-phone';
  if (/keyboard|键盘/.test(n)) return 'ic-keyboard';
  if (/gamepad|controller|dualsense|手柄/.test(n)) return 'ic-gamepad';
  if (/receiver|mouse|鼠标|2\.4g/.test(n)) return 'ic-mouse';
  if (d.cls === 'Net' || /rndis|network|以太网/.test(n)) return 'ic-net';
  if (/billboard|备用模式/.test(n)) return 'ic-usb';
  if (/audio|耳机|扬声器/.test(n)) return 'ic-audio';
  return 'ic-usb';
}

const svgIcon = (id) => `<svg><use href="#${id}"/></svg>`;

function typeLabel(d) {
  if (d.disk) return T('type.disk');
  const kinds = d.kinds || [];
  if (kinds.includes('Net') || d.cls === 'Net') return T('type.net');
  if (kinds.includes('WPD')) return T('type.wpd');
  if (kinds.includes('Camera')) return T('type.camera');
  if (kinds.includes('DiskDrive') || kinds.includes('SCSIAdapter')) return T('type.disk');
  if (kinds.includes('CDROM')) return T('type.cdrom');
  if (kinds.includes('Mouse') || kinds.includes('Keyboard') || kinds.includes('HIDClass')) return T('type.hid');
  if (kinds.includes('MEDIA')) return T('type.audio');
  const map = {
    DiskDrive: 'type.disk', SCSIAdapter: 'type.bridge', CDROM: 'type.cdrom',
    Camera: 'type.camera', WPD: 'type.wpd', USBDevice: 'type.altmode', Net: 'type.net',
    HIDClass: 'type.hid', Mouse: 'type.mouse', Keyboard: 'type.keyboard',
    Bluetooth: 'type.bluetooth', MEDIA: 'type.audio', USB: 'type.composite',
  };
  if (d.labelKind === 'hub' || d.labelKind === 'ssHub' || d.labelKind === 'rootHub') return T('type.hub');
  return map[d.cls] ? T(map[d.cls]) : (d.cls || T('type.device'));
}

/** Real negotiated rate when the platform reports it, otherwise the lane class. */
function linkCell(d) {
  if (d.speed) {
    const txt = d.speed >= 1000 ? `${+(d.speed / 1000).toFixed(1)} Gbps` : `${d.speed} Mbps`;
    return { cls: d.lane === 'ss' ? 'ss' : 'hs', txt };
  }
  if (d.lane === 'ss') return { cls: 'ss', txt: T('lane.ss') };
  if (d.lane === 'root') return { cls: '', txt: T('lane.root') };
  if (d.lane === 'fs') return { cls: 'hs', txt: T('lane.fs') };
  return { cls: 'hs', txt: T('lane.hs') };
}

/* ============================================================ renderers */
function renderTop(frame) {
  $('clock').textContent = hhmmss(Date.now());

  const src = frame.sources || {};
  const okInv = src.inventory === 'ok';
  const okPerf = src.perf === 'ok';
  const gpu = src.gpu === 'ok' ? T('src.ok') : src.gpu === 'missing' ? T('src.missing') : T('src.bad');
  const line = $('srcline');
  line.className = `srcline ${okInv && okPerf ? 'ok' : 'warn'}`;
  $('srcTxt').textContent = [
    `${T('src.devices')} ${okInv ? T('src.ok') : T('src.bad')}`,
    `${T('src.sampling')} ${okPerf ? T('src.ok') : T('src.bad')}`,
    `${T('src.gpu')} ${gpu}`,
  ].join(' · ');
}

function renderKPI(frame) {
  const p = frame.power || {};
  const dock = (S.model && S.model.dock) || { devices: [], ss: [], hs: [], uplink: '', hubs: [] };
  const bat = S.battery;

  // power source badge
  const tag = $('powerTag');
  const note = $('powerNote');
  if (p.source === 'battery') {
    tag.className = 'tag measured';
    tag.textContent = T('tag.measured');
    note.textContent = T('power.note.measured');
  } else if (p.source === 'rapl') {
    tag.className = 'tag est';
    tag.textContent = T('tag.est');
    note.textContent = T('power.note.rapl');
  } else {
    tag.className = 'tag est';
    tag.textContent = T('tag.est');
    note.textContent = T('power.note.model');
  }
  tag.title = T('power.tag.title');

  $('kPower').textContent = fmt(p.total);
  $('kPowerFoot').textContent = p.source === 'battery'
    ? T('kpi.power.foot.measured', { total: fmt(p.total), gpu: fmt(p.gpuPart) })
    : T('kpi.power.foot.model', { cpu: fmt(p.cpuPart), base: fmt(p.basePart) });
  drawSpark($('spkPower'), S.history.slice(-140).map((x) => x.p), '#2fe3a0');

  $('kDevs').textContent = dock.devices.length;
  $('kDevsFoot').textContent = T('kpi.devs.foot', { ss: dock.ss.length, hs: dock.hs.length });
  const dots = [].concat(
    dock.ss.slice(0, 8).map(() => 'ss'),
    dock.hs.slice(0, 8).map(() => 'on')
  );
  $('kDevDots').innerHTML = Array.from({ length: Math.max(6, dots.length) })
    .map((_, i) => `<i class="${dots[i] || ''}"></i>`)
    .join('');

  const mbps = dock.uplinkMbps || 0;
  const ss = mbps >= 5000;
  $('kLink').textContent = mbps ? (mbps >= 1000 ? `${+(mbps / 1000).toFixed(mbps % 1000 === 0 ? 0 : 1)}` : `${mbps}`) : '—';
  $('kLinkUnit').textContent = mbps && mbps < 1000 ? 'Mbps' : 'Gbps';
  $('kLinkFoot').textContent = dock.present
    ? T('kpi.link.foot', { n: dock.hubs.length })
    : T('kpi.link.none');
  $('kLanes').innerHTML = `
    <span><i class="${ss ? 'on blue' : ''}"></i>SuperSpeed</span>
    <span><i class="on"></i>High Speed</span>`;

  if (bat) {
    $('kBat').textContent = bat.pct;
    $('kBatFoot').textContent = bat.ac ? T('kpi.bat.ac') : T('kpi.bat.batt');
    $('kBatBar').style.width = `${bat.pct}%`;
  } else {
    $('kBat').textContent = '—';
    $('kBatFoot').textContent = T('kpi.bat.none');
    $('kBatBar').style.width = '0%';
  }
}

function renderLink(frame) {
  const md = S.model || {};
  const dock = md.dock || {};
  const host = md.host || {};

  $('hostName').textContent = `${host.vendor || ''} ${host.model || ''}`.trim() || T('link.host.self');
  $('hostSub').textContent = `${host.cpu || '—'} · ${host.cores || 0} threads`;
  const osShort = `${host.os || ''}`.replace('Microsoft ', '').replace(/Windows\s*(\d+)/i, 'Win $1').replace(/\s*(专业版|家庭版|企业版)/, '');
  $('hostMeta').innerHTML = `<span>${T('link.host.mem')} <b>${fmt(host.ramGB, 1)} GB</b></span><span>${esc(osShort)} <b>${esc(host.osBuild || '')}</b></span>`;

  $('linkPanel').classList.toggle('dead', !dock.present);

  $('cableLabel').textContent = dock.present ? T('link.cable') : T('link.cable.none');
  $('cableSub').textContent = dock.uplink || '—';

  $('dockName').textContent = dock.name || T('link.dock');
  $('dockSub').textContent = dock.present
    ? T('link.dock.sub', { vendor: dock.vendor || 'Hub', vid: String(dock.vid || '').toUpperCase(), hubs: dock.hubs.length })
    : T('link.dock.none');

  const chans = [];
  const monitors = md.monitors || [];
  // never present the laptop's own panel as a dock video output
  const extMon = monitors.find((x) => !x.internal);
  if (extMon) {
    chans.push(`<span title="${esc(T('chan.video.title'))}">${esc(T('chan.video', { name: extMon.model || extMon.mfr || '—' }))}</span>`);
  } else {
    chans.push(`<span class="off">${esc(T('chan.video.none'))}</span>`);
  }

  if (md.ethernet && md.ethernet.status === 'Up') chans.push(`<span>${esc(T('chan.eth', { speed: md.ethernet.speed || '' }))}</span>`);
  else chans.push(`<span class="off">${esc(T('chan.eth.none'))}</span>`);

  chans.push(S.battery && S.battery.ac ? `<span>${esc(T('chan.power.ac'))}</span>` : `<span class="off">${esc(T('chan.power.batt'))}</span>`);
  if (dock.billboard) chans.push(`<span>${esc(T('chan.altmode'))}</span>`);
  $('dockChans').innerHTML = chans.join('');

  $('portCount').textContent = T('link.ports.count', { n: dock.devices.length });
  const flow = $('portFlow');
  if (!dock.devices.length) {
    flow.innerHTML = `<div class="port-chip empty"><div class="ico">${svgIcon('ic-usb')}</div><div><b>${esc(T('link.ports.empty'))}</b><small>${esc(T('link.ports.idle'))}</small></div></div>`;
  } else {
    flow.innerHTML = dock.devices
      .slice()
      .sort((a, b) => (a.lane === b.lane ? a.port - b.port : a.lane === 'ss' ? -1 : 1))
      .map((d) => {
        const speedTxt = d.speed ? (d.speed >= 1000 ? `${+(d.speed / 1000).toFixed(1)} Gbps` : `${d.speed} Mbps`) : null;
        const meta = [
          d.port ? T('link.meta.port', { port: d.port }) : '',
          d.disk ? `${d.disk.sizeGB} GB` : speedTxt,
        ].filter(Boolean).join(' · ');
        return `<div class="port-chip ${d.lane === 'ss' ? 'ss' : ''}">
          <div class="ico">${svgIcon(iconFor(d))}</div>
          <div><b title="${esc(d.name)}">${esc(short(d.name, 19))}</b><small>${esc(meta)}</small></div>
        </div>`;
      })
      .join('');
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function short(s, n) {
  s = String(s || '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function renderTable(frame) {
  const md = S.model;
  if (!md) return;
  const body = $('devBody');
  const perDisk = frame.perDisk || {};
  const rows = [];

  const diskAct = (d) => {
    if (!d.disk) return null;
    const a = perDisk[d.disk.n] || { r: 0, w: 0 };
    return (a.r + a.w) / 1048576;
  };

  const rowHtml = (d) => {
    const act = diskAct(d);
    const actCell =
      act == null
        ? '<span class="act-num">—</span>'
        : `<div class="act"><div class="act-bar"><i style="width:${Math.min(100, (act / 40) * 100)}%"></i></div><span class="act-num">${act.toFixed(1)} MB/s</span></div>`;
    const st = d.status === 'ok'
      ? `<span class="st"><i></i>${esc(T('status.ok'))}</span>`
      : `<span class="st warn"><i></i>${esc(d.problem ? T('status.code', { n: d.problem }) : T('status.err'))}</span>`;
    const cap = d.disk
      ? `<div class="dev-cap" title="${esc(d.disk.model || '')}">${d.disk.sizeGB} GB${d.disk.letters && d.disk.letters.length ? ' · ' + esc(d.disk.letters.join(' ')) : ''}</div>`
      : '';
    const link = linkCell(d);
    const portCell = d.port
      ? `<span class="pill" title="${esc(d.loc)}">P${d.port}</span>${d.depth > 1 ? '<i class="lv">L2</i>' : ''}`
      : '<span style="color:#3d4b5c">—</span>';
    return `<tr>
      <td class="c-name"><div class="dev-cell"><div class="ico">${svgIcon(iconFor(d))}</div><div style="min-width:0"><div class="dev-name">${esc(d.name)}</div>${cap}</div></div></td>
      <td>${esc(typeLabel(d))}</td>
      <td>${portCell}</td>
      <td><span class="pill ${link.cls}">${esc(link.txt)}</span></td>
      <td style="font-family:var(--mono);font-size:11px;color:#6f8296">${d.vid ? `${esc(d.vid)}:${esc(d.pid)}` : '—'}</td>
      <td>${actCell}</td>
      <td>${st}</td>
    </tr>`;
  };

  const list = (arr) => arr.filter((d) => !d.isHub);
  const dockDevs = list(md.dock.devices);
  const directDevs = list(md.direct);

  if (dockDevs.length) {
    rows.push(`<tr class="group-row"><td colspan="7"><span class="g-tag">◆</span>${esc(T('group.dock', { uplink: md.dock.uplink, n: dockDevs.length }))}</td></tr>`);
    dockDevs.forEach((d) => rows.push(rowHtml(d)));
  } else {
    rows.push(`<tr class="group-row"><td colspan="7"><span class="g-tag">◆</span>${esc(T('group.dock.empty'))}</td></tr>`);
  }
  if (directDevs.length) {
    rows.push(`<tr class="group-row direct"><td colspan="7"><span class="g-tag">◇</span>${esc(T('group.direct', { n: directDevs.length }))}</td></tr>`);
    directDevs.forEach((d) => rows.push(rowHtml(d)));
  }

  body.innerHTML = rows.join('');
  $('devTag').textContent = T('dev.tag', { n: dockDevs.length + directDevs.length });
}

function renderLoad(frame) {
  const m = frame.m || {};
  const host = (S.model && S.model.host) || {};
  const totalGB = host.ramGB || 16;
  const usedPhys = Math.max(0, totalGB - (m.memFreeGB || 0));
  const memPct = totalGB ? (usedPhys / totalGB) * 100 : m.mem || 0;

  $('lCpu').textContent = `${fmt(m.cpu, 0)}%`;
  $('bCpu').style.width = `${Math.min(100, m.cpu || 0)}%`;
  $('lCpuSub').textContent = T('load.cpu.sub', { cores: host.cores || '—', freq: m.freq ? fmt(m.freq, 0) : '—' });

  $('lGpu').textContent = m.gpuUtil == null ? '—' : `${fmt(m.gpuUtil, 0)}%`;
  $('bGpu').style.width = `${Math.min(100, m.gpuUtil || 0)}%`;
  if (m.gpuW == null && m.gpuTemp == null && m.gpuClock == null) {
    $('lGpuSub').textContent = T('load.gpu.sub.none');
  } else {
    const parts = [];
    if (m.gpuW != null) parts.push(`${fmt(m.gpuW, 2)} W`);
    if (m.gpuTemp != null) parts.push(`${fmt(m.gpuTemp, 0)} °C`);
    if (m.gpuClock != null) parts.push(`${fmt(m.gpuClock, 0)} MHz`);
    $('lGpuSub').textContent = parts.join(' · ');
  }

  $('lMem').textContent = `${fmt(memPct, 0)}%`;
  $('bMem').style.width = `${Math.min(100, memPct)}%`;
  $('lMemSub').textContent = T('load.mem.sub', { used: fmt(usedPhys, 1), total: fmt(totalGB, 1) });

  const dTotal = (m.diskR || 0) + (m.diskW || 0);
  $('lDisk').textContent = `${fmt(dTotal, 1)} MB/s`;
  $('bDisk').style.width = `${Math.min(100, (dTotal / 200) * 100)}%`;
  $('lDiskSub').textContent = S.caps && S.caps.diskSplit === false
    ? T('load.disk.sub.combined', { t: fmt(dTotal, 1) })
    : T('load.disk.sub', { r: fmt(m.diskR, 1), w: fmt(m.diskW, 1) });

  const nTotal = ((m.netRx || 0) + (m.netTx || 0)) * 8;
  $('lNet').textContent = `${fmt(nTotal, 1)} Mb/s`;
  $('bNet').style.width = `${Math.min(100, (nTotal / 500) * 100)}%`;
  $('lNetSub').textContent = T('load.net.sub', { rx: fmt((m.netRx || 0) * 8, 1), tx: fmt((m.netTx || 0) * 8, 1) });

  const bat = S.battery;
  $('powerCells').innerHTML = bat
    ? `
    <div><div class="pc-label">${esc(T('cells.bat.pct'))}</div><div class="pc-val">${bat.pct != null ? bat.pct : '—'}<small>%</small></div></div>
    <div><div class="pc-label">${esc(T('cells.bat.volt'))}</div><div class="pc-val">${fmt(bat.volt, 2)}<small>V</small></div></div>
    <div><div class="pc-label">${esc(T('cells.bat.state'))}</div><div class="pc-val" style="font-size:12px">${esc(bat.ac ? T('cells.bat.ac') : T('cells.bat.batt'))}<small>${bat.charging ? '' : esc(T('cells.bat.nocharge'))}</small></div></div>
    <div><div class="pc-label">${esc(T('cells.bat.full'))}</div><div class="pc-val">${bat.fullMWh ? fmt(bat.fullMWh / 1000, 2) : '—'}<small>Wh</small></div></div>`
    : `<div style="grid-column:1/-1;color:var(--txt3);font-size:12px">${esc(T('cells.bat.none'))}</div>`;
}

function eventDetail(e) {
  const p = e.p || {};
  switch (e.k) {
    case 'event.scan.start':
      return T('event.scan.start.detail', { n: p.n });
    case 'event.dock.found':
      return T('event.dock.found.detail', { vendor: p.vendor, uplink: p.uplink, n: p.n });
    case 'event.device.add':
      return [p.name, p.port ? T('link.meta.port', { port: p.port }) : '', p.where ? T(`where.${p.where}`) : '']
        .filter(Boolean).join(' · ');
    case 'event.device.remove':
      return [p.name, p.port ? T('link.meta.port', { port: p.port }) : ''].filter(Boolean).join(' · ');
    case 'event.dock.lost':
      return T('event.dock.lost.detail');
    case 'event.dock.connected':
      return p.uplink || '';
    case 'event.eth.change':
      return `${p.from} → ${p.to}`;
    case 'event.demo':
      return T('event.demo.detail');
    case 'event.started':
      return T('event.started.detail', { n: p.n });
    default:
      return '';
  }
}

function renderEvents() {
  const list = S.events.slice(0, 40);
  $('evCount').textContent = T('ev.count', { n: S.events.length });
  $('events').innerHTML = list.length
    ? list.map((e) => {
      const detail = eventDetail(e);
      return `<div class="ev ${e.kind}">
        <i></i><div class="ev-t">${hhmmss(e.t)}</div>
        <div class="ev-b"><div class="ev-title">${esc(I18N.eventTitle(e.k))}</div>${detail ? `<div class="ev-detail">${esc(detail)}</div>` : ''}</div>
      </div>`;
    }).join('')
    : `<div class="ev"><i></i><div class="ev-t">--:--</div><div class="ev-b"><div class="ev-title" style="color:#5f7085">${esc(T('ev.empty'))}</div></div></div>`;
}

function renderChartFoot() {
  const pts = S.history.slice(-WINDOW_S);
  if (!pts.length) return;
  const vals = pts.map((p) => p.p);
  const peak = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  $('pPeak').textContent = `${fmt(peak)} W`;
  $('pAvg').textContent = `${fmt(avg)} W`;
  $('pEnergy').textContent = `${fmt(S.energyWh, 3)} Wh`;
}

function renderChrome(frame) {
  const caps = frame.caps || {};
  $('loadSrc').textContent = T('load.src', { mode: caps.inventoryMode || '—' });
  const invSec = caps.inventoryIntervalMs ? Math.round(caps.inventoryIntervalMs / 1000) : 2;
  $('evTree').textContent = `${invSec} s`;
  $('footSampling').textContent = T('foot.sampling', {
    perf: caps.inventoryMode || '—',
    inv: invSec,
    gpu: caps.gpuPower ? 'nvidia-smi' : 'n/a',
  });
  $('brandSub').textContent = S.model && S.model.host
    ? T('brand.live', { host: `${S.model.host.vendor || ''} ${S.model.host.model || ''}`.trim() || T('link.host.self') })
    : T('brand.sub');
}

/* ============================================================ frame apply */
function applyFrame(f) {
  S.m = f.m || {};
  S.power = f.power;
  S.caps = f.caps || S.caps || {};
  if (f.model) S.model = f.model;
  if (f.model && f.model.battery) S.battery = f.model.battery;
  if (f.model && f.model.host) S.host = f.model.host;
  S.sources = f.sources || {};
  S.energyWh = f.energyWh || 0;

  if (f.type === 'hello') {
    S.history = f.history || [];
  } else if (f.t) {
    S.history.push({ t: f.t, p: f.power.total, pc: f.power.cpuPart, pg: f.power.gpuPart, cpu: f.m.cpu, gpu: f.m.gpuUtil });
    if (S.history.length > 2400) S.history.shift();
  }
  if (f.events) S.events = f.events;
  if (f.startedAt) {
    const secs = Math.max(0, Math.floor((Date.now() - f.startedAt) / 1000));
    $('evUptime').textContent = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  }

  renderChrome(f);
  renderTop(f);
  if (f.demo) {
    const pill = $('livePill');
    pill.classList.add('demo');
    pill.innerHTML = '<span class="pulse"></span>DEMO';
  }
  const gpuWrap = document.querySelector('.sw-gpu-wrap');
  if (gpuWrap && S.power) gpuWrap.style.display = S.power.gpuReal === false ? 'none' : '';

  renderKPI(f);
  renderLink(f);
  renderTable(f);
  renderLoad(f);
  renderEvents();
  renderChartFoot();
  drawPower();
}

/* ============================================================ SSE */
let evtSrc = null;
let offlineTimer = null;
let lastFrame = null;

function connect() {
  evtSrc = new EventSource('/api/stream');

  evtSrc.onopen = () => {
    S.connected = true;
    $('offline').classList.remove('show');
    $('livePill').classList.remove('paused');
  };

  evtSrc.onmessage = (ev) => {
    try {
      const f = JSON.parse(ev.data);
      lastFrame = f;
      applyFrame(f);
    } catch (e) {
      console.warn('bad frame', e);
    }
  };

  evtSrc.onerror = () => {
    S.connected = false;
    $('livePill').classList.add('paused');
    clearTimeout(offlineTimer);
    offlineTimer = setTimeout(() => $('offline').classList.add('show'), 1500);
  };
}

/* ticker for clock even if no frames */
setInterval(() => {
  $('clock').textContent = hhmmss(Date.now());
}, 1000);

window.addEventListener('resize', () => {
  drawPower();
  drawSpark($('spkPower'), S.history.slice(-140).map((x) => x.p), '#2fe3a0');
});

/* language switch */
function syncLangBtn() {
  $('langBtn').textContent = I18N.lang === 'zh' ? 'EN' : '中文';
}
$('langBtn').addEventListener('click', () => {
  I18N.toggle();
  syncLangBtn();
  if (lastFrame) applyFrame(lastFrame);
});

document.addEventListener('langchange', () => {
  if (lastFrame) applyFrame(lastFrame);
});

I18N.apply();
syncLangBtn();
connect();
