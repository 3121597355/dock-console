'use strict';

/**
 * A small curated VID → vendor table. USB-IF publishes a ~25k entry list; this
 * covers the vendors that actually show up behind a dock. Add your own here —
 * the top-level keys are lowercase hex vendor ids.
 */
const VENDORS = {
  '0403': 'FTDI',
  '0424': 'Microchip',
  '046d': 'Logitech',
  '048d': 'ITE',
  '04d9': 'Holtek',
  '04e8': 'Samsung',
  '04f2': 'Chicony',
  '04f3': 'ELAN',
  '054c': 'Sony',
  '058f': 'Alcor',
  '05e3': 'Genesys',
  '0781': 'SanDisk',
  '0b95': 'ASIX',
  '0bda': 'Realtek',
  '0bc2': 'Seagate',
  '0e8d': 'MediaTek',
  '1058': 'WD',
  '12d1': 'HUAWEI',
  '13d3': 'IMC Networks',
  '152d': 'JMicron',
  '174c': 'ASMedia',
  '17ef': 'Lenovo',
  '18d1': 'Google',
  '19d2': 'ZTE',
  '1a40': 'Terminus',
  '1bcf': 'Sunplus',
  '2109': 'VIA Labs',
  '2188': 'Caldigit',
  '2717': 'Xiaomi',
  '291a': 'Anker',
  '2b7c': 'UGREEN',
  '3151': 'MCHOSE',
  '413c': 'Dell',
  '41e4': 'MCHOSE',
  '8087': 'Intel',
  '8564': 'Transcend',
};

function vendorName(vid) {
  return VENDORS[String(vid || '').toLowerCase()] || '';
}

module.exports = { VENDORS, vendorName };
