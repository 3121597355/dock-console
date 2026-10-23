'use strict';
/**
 * Tiny i18n layer.
 *
 * Deliberately not a framework: two dictionaries, a dotted-key lookup and a
 * DOM pass over data-i18n attributes. The whole UI is ~180 strings, so pulling
 * in a library would cost more than it saves.
 *
 * Language resolution:  ?lang= > localStorage > navigator.language > en
 */
(function () {
  const DICT = {
    en: {
      ui: {
        'app.title': 'Dock Console · realtime dock monitor',
        'brand.sub': 'Dock monitor',
        'brand.live': '{host} · live',
        'lang.title': 'Switch language',
        'offline': 'Lost the connection to the local collector — reconnecting…',
        'src.devices': 'devices',
        'src.sampling': 'sampling',
        'src.gpu': 'GPU',
        'src.ok': 'ok',
        'src.bad': 'error',
        'src.missing': 'n/a',

        'kpi.power': 'System power',
        'kpi.power.waiting': 'waiting for samples',
        'kpi.power.foot.model': 'CPU {cpu} W · base {base} W',
        'kpi.power.foot.measured': 'measured {total} W · GPU {gpu} W',
        'tag.est': 'estimated',
        'tag.measured': 'measured',
        'kpi.devs': 'Dock devices',
        'unit.devices': 'devices',
        'kpi.devs.foot': 'USB 3.x {ss} · USB 2.0 {hs}',
        'kpi.link': 'Uplink',
        'kpi.link.foot': '{n} hub levels',
        'kpi.link.none': 'no dock detected',
        'kpi.bat': 'Power',
        'unit.pct': '%',
        'kpi.bat.ac': 'AC connected',
        'kpi.bat.batt': 'on battery',
        'kpi.bat.none': 'no battery',

        'link.host': 'Host',
        'link.host.self': 'this machine',
        'link.cable': 'USB-C uplink',
        'link.cable.none': 'not connected',
        'link.dock': 'Dock',
        'link.dock.none': 'not detected',
        'link.dock.sub': '{vendor} · VID {vid} · {hubs} hub levels',
        'link.ports': 'Downstream ports',
        'link.ports.count': '{n} in use',
        'link.ports.empty': 'No downstream devices',
        'link.ports.idle': 'idle',
        'link.meta.port': 'port {port}',
        'link.host.mem': 'RAM',
        'chan.video': 'Video · {name}',
        'chan.video.none': 'Video · none',
        'chan.video.title': 'A display is present, but the OS does not expose which physical port carries the signal',
        'chan.eth': 'Ethernet · {speed}',
        'chan.eth.none': 'Ethernet · down',
        'chan.power.ac': 'Power · AC',
        'chan.power.batt': 'Power · battery',
        'chan.altmode': 'DP Alt Mode · negotiated',

        'power.title': 'Realtime power',
        'power.legend.total': 'Total',
        'power.legend.cpu': 'CPU share',
        'power.legend.gpu': 'GPU measured',
        'power.win': 'last {n} min',
        'power.peak': 'Peak',
        'power.avg': 'Average',
        'power.energy': 'Energy',
        'power.note.measured': 'Total is measured: battery voltage × amperage',
        'power.note.rapl': 'CPU watts measured through RAPL; the remainder is modelled',
        'power.note.model': 'Total is modelled: base + CPU% × TDP + measured GPU',
        'power.tag.title': 'Where this number comes from',
        'power.collecting': 'collecting…',
        'power.now': 'now',
        'tip.total': 'Total',
        'tip.cpu': 'CPU share',
        'tip.gpu': 'GPU measured',

        'load.title': 'Live load',
        'load.src': '{mode} · 1 Hz',
        'load.cpu': 'CPU',
        'load.gpu': 'GPU',
        'load.mem': 'Memory',
        'load.disk': 'Disk I/O',
        'load.net': 'Network',
        'load.cpu.sub': '{cores} threads · {freq}% of max',
        'load.gpu.sub.none': 'no telemetry',
        'load.gpu.sub': '{w} W · {t} °C · {c} MHz',
        'load.mem.sub': '{used} / {total} GB used',
        'load.disk.sub': 'read {r} · write {w} MB/s',
        'load.disk.sub.combined': '{t} MB/s total',
        'load.net.sub': '↓ {rx} · ↑ {tx} Mb/s',
        'cells.bat.pct': 'Battery',
        'cells.bat.volt': 'Voltage',
        'cells.bat.state': 'Power state',
        'cells.bat.full': 'Full charge',
        'cells.bat.ac': 'AC',
        'cells.bat.batt': 'Battery',
        'cells.bat.nocharge': 'not charging',
        'cells.bat.none': 'no battery exposed',

        'dev.title': 'Connected devices',
        'dev.tag': '{n} online',
        'dev.note': 'port numbers come from OS enumeration',
        'th.name': 'Device',
        'th.type': 'Type',
        'th.port': 'Port',
        'th.lane': 'Link',
        'th.vid': 'VID:PID',
        'th.act': 'Activity',
        'th.st': 'Status',
        'group.dock': 'Dock · {uplink} · {n} devices',
        'group.dock.empty': 'Dock · no downstream devices',
        'group.direct': 'Host USB ports · direct · {n} devices',
        'lane.ss': 'USB 3.x',
        'lane.hs': 'USB 2.0',
        'lane.fs': 'USB 1.x',
        'lane.root': 'direct',
        'lane.speed': '{v} Gbps',
        'status.ok': 'ok',
        'status.err': 'error',
        'status.code': 'code {n}',
        'type.disk': 'Storage',
        'type.bridge': 'Bridge',
        'type.cdrom': 'Optical',
        'type.camera': 'Camera',
        'type.wpd': 'Mobile',
        'type.hid': 'Input',
        'type.mouse': 'Mouse',
        'type.keyboard': 'Keyboard',
        'type.bluetooth': 'Bluetooth',
        'type.audio': 'Audio',
        'type.net': 'Network',
        'type.composite': 'Composite',
        'type.altmode': 'Alt mode',
        'type.hub': 'Hub',
        'type.device': 'Device',
        'label.rootHub': 'Root hub',
        'label.ssHub': 'SuperSpeed hub',
        'label.hub': 'USB hub',

        'ev.title': 'Event stream',
        'ev.count': '{n}',
        'ev.empty': 'no events yet',
        'ev.uptime': 'Session',
        'ev.tree': 'Device tree',
        'ev.sample': 'Sampling',
        'where.dock': 'dock',
        'where.direct': 'host port',
        'foot.sampling': 'Sampling {perf} @ 1 Hz · device tree {inv}s · GPU {gpu}',
        'foot.truth': 'Dock topology, link speed, disk and network throughput are read from the OS. Power is labelled measured or estimated.',

        'event.scan.start': 'Monitoring started',
        'event.scan.start.detail': '{n} physical USB devices enumerated',
        'event.dock.found': 'Dock detected',
        'event.dock.found.detail': '{vendor} · uplink {uplink} · {n} downstream devices',
        'event.device.add': 'Device connected',
        'event.device.remove': 'Device removed',
        'event.dock.lost': 'Dock disconnected',
        'event.dock.lost.detail': 'no dock hub found on any root hub',
        'event.dock.connected': 'Dock connected',
        'event.eth.change': 'Ethernet link changed',
        'event.power.ac': 'Switched to AC power',
        'event.power.battery': 'Switched to battery',
        'event.demo': 'Demo mode',
        'event.demo.detail': 'synthetic dock · no hardware access',
        'event.started': 'Console started',
        'event.started.detail': '1 Hz sampling · device tree every {n}s',
      },
    },

    zh: {
      ui: {
        'app.title': 'Dock Console · 扩展坞运行监控台',
        'brand.sub': '扩展坞运行监控台',
        'brand.live': '{host} · 实时监控中',
        'lang.title': '切换语言',
        'offline': '与本地采集服务的连接已断开，正在重连…',
        'src.devices': '设备树',
        'src.sampling': '采样',
        'src.gpu': 'GPU',
        'src.ok': '正常',
        'src.bad': '异常',
        'src.missing': '未安装',

        'kpi.power': '整机功率',
        'kpi.power.waiting': '等待采样',
        'kpi.power.foot.model': 'CPU 分摊 {cpu} W · 基线 {base} W',
        'kpi.power.foot.measured': '实测 {total} W · GPU {gpu} W',
        'tag.est': '估算',
        'tag.measured': '实测',
        'kpi.devs': '扩展坞设备',
        'unit.devices': '台',
        'kpi.devs.foot': 'USB 3.x {ss} · USB 2.0 {hs}',
        'kpi.link': '上行链路',
        'kpi.link.foot': '{n} 级集线器',
        'kpi.link.none': '未检测到扩展坞',
        'kpi.bat': '供电状态',
        'unit.pct': '%',
        'kpi.bat.ac': '交流电接入',
        'kpi.bat.batt': '电池供电中',
        'kpi.bat.none': '未检测到电池',

        'link.host': '主机',
        'link.host.self': '本机',
        'link.cable': 'USB-C 上行',
        'link.cable.none': '未连接',
        'link.dock': '扩展坞',
        'link.dock.none': '未检测到',
        'link.dock.sub': '{vendor} · VID {vid} · {hubs} 级集线器',
        'link.ports': '下游端口',
        'link.ports.count': '{n} 个占用',
        'link.ports.empty': '无下游设备',
        'link.ports.idle': '空闲',
        'link.meta.port': '端口 {port}',
        'link.host.mem': '内存',
        'chan.video': '视频 · {name}',
        'chan.video.none': '视频 · 未识别',
        'chan.video.title': '检测到外接显示器；系统未提供显示通道的物理归属',
        'chan.eth': '网口 · {speed}',
        'chan.eth.none': '网口 · 未接入',
        'chan.power.ac': '供电 · 交流电',
        'chan.power.batt': '供电 · 电池',
        'chan.altmode': 'DP Alt Mode · 已协商',

        'power.title': '实时功耗',
        'power.legend.total': '总功耗',
        'power.legend.cpu': 'CPU 分摊',
        'power.legend.gpu': 'GPU 实测',
        'power.win': '近 {n} 分钟',
        'power.peak': '峰值',
        'power.avg': '均值',
        'power.energy': '累计耗电',
        'power.note.measured': '总功耗为实测值：电池电压 × 电流',
        'power.note.rapl': 'CPU 功率由 RAPL 实测，其余部分为估算',
        'power.note.model': '总功耗为估算值：基线 + CPU 占用 × TDP + GPU 实测',
        'power.tag.title': '该数值的来源',
        'power.collecting': '正在采集数据…',
        'power.now': '现在',
        'tip.total': '总功耗',
        'tip.cpu': 'CPU 分摊',
        'tip.gpu': 'GPU 实测',

        'load.title': '实时负载',
        'load.src': '{mode} · 1 Hz',
        'load.cpu': 'CPU',
        'load.gpu': 'GPU',
        'load.mem': '内存',
        'load.disk': '磁盘吞吐',
        'load.net': '网络吞吐',
        'load.cpu.sub': '{cores} 线程 · 频率 {freq}%',
        'load.gpu.sub.none': '无遥测',
        'load.gpu.sub': '{w} W · {t} °C · {c} MHz',
        'load.mem.sub': '{used} / {total} GB 已用',
        'load.disk.sub': '读 {r} · 写 {w} MB/s',
        'load.disk.sub.combined': '合计 {t} MB/s',
        'load.net.sub': '↓ {rx} · ↑ {tx} Mb/s',
        'cells.bat.pct': '电池电量',
        'cells.bat.volt': '电池电压',
        'cells.bat.state': '电源状态',
        'cells.bat.full': '满充容量',
        'cells.bat.ac': '交流供电',
        'cells.bat.batt': '电池供电',
        'cells.bat.nocharge': '未充电',
        'cells.bat.none': '未检测到电池',

        'dev.title': '已连接设备',
        'dev.tag': '{n} 台在线',
        'dev.note': '端口号源自系统枚举地址',
        'th.name': '设备',
        'th.type': '类型',
        'th.port': '端口',
        'th.lane': '链路',
        'th.vid': 'VID:PID',
        'th.act': '活动',
        'th.st': '状态',
        'group.dock': '扩展坞 · {uplink} · {n} 台',
        'group.dock.empty': '扩展坞 · 未连接下游设备',
        'group.direct': '本机 USB 端口 · 未经过扩展坞 · {n} 台',
        'lane.ss': 'USB 3.x',
        'lane.hs': 'USB 2.0',
        'lane.fs': 'USB 1.x',
        'lane.root': '直连',
        'lane.speed': '{v} Gbps',
        'status.ok': '正常',
        'status.err': '异常',
        'status.code': '代码 {n}',
        'type.disk': '存储',
        'type.bridge': '存储桥',
        'type.cdrom': '光驱',
        'type.camera': '摄像头',
        'type.wpd': '移动设备',
        'type.hid': '输入设备',
        'type.mouse': '鼠标',
        'type.keyboard': '键盘',
        'type.bluetooth': '蓝牙',
        'type.audio': '音频',
        'type.net': '网络',
        'type.composite': '复合设备',
        'type.altmode': '备用模式',
        'type.hub': '集线器',
        'type.device': '设备',
        'label.rootHub': '根集线器',
        'label.ssHub': 'SuperSpeed 集线器',
        'label.hub': 'USB 集线器',

        'ev.title': '事件流',
        'ev.count': '{n} 条',
        'ev.empty': '暂无事件',
        'ev.uptime': '会话时长',
        'ev.tree': '设备树',
        'ev.sample': '采样',
        'where.dock': '扩展坞',
        'where.direct': '本机直连',
        'foot.sampling': '采样 {perf} · 1 Hz · 设备树 {inv}s · GPU {gpu}',
        'foot.truth': '扩展坞拓扑、链路速率、磁盘与网络吞吐均为系统真实读数；功率已标注实测或估算。',

        'event.scan.start': '监测已启动',
        'event.scan.start.detail': '已枚举 {n} 个物理 USB 设备',
        'event.dock.found': '扩展坞已识别',
        'event.dock.found.detail': '{vendor} · 上行 {uplink} · {n} 个下游设备',
        'event.device.add': '设备接入',
        'event.device.remove': '设备移除',
        'event.dock.lost': '扩展坞已断开',
        'event.dock.lost.detail': '所有根集线器下均未找到扩展坞集线器',
        'event.dock.connected': '扩展坞已连接',
        'event.eth.change': '以太网状态变化',
        'event.power.ac': '已接入交流电',
        'event.power.battery': '已切换电池供电',
        'event.demo': '演示模式',
        'event.demo.detail': '合成的扩展坞数据 · 未连接真实硬件',
        'event.started': '控制台已启动',
        'event.started.detail': '采样 1 Hz · 设备清单 {n} s',
      },
    },
  };

  const STORAGE_KEY = 'dockconsole.lang';

  function detect() {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && DICT[q]) return q;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DICT[saved]) return saved;
    } catch (e) { /* private mode */ }
    const nav = (navigator.language || 'en').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  }

  let lang = detect();

  function fill(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k])));
  }

  function t(key, params) {
    const dict = DICT[lang] || DICT.en;
    let s = dict.ui[key];
    if (s == null) s = DICT.en.ui[key];
    if (s == null) return key;
    return fill(s, params);
  }

  function eventTitle(key) {
    const dict = DICT[lang] || DICT.en;
    return dict.ui[key] || DICT.en.ui[key] || key;
  }

  function apply() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('app.title');
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.title = t(el.getAttribute('data-i18n-title'));
    }
  }

  function set(next) {
    if (!DICT[next]) return;
    lang = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
    apply();
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function toggle() {
    set(lang === 'zh' ? 'en' : 'zh');
  }

  window.I18N = { t, eventTitle, apply, set, toggle, get lang() { return lang; } };
})();
