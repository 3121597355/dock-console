# Dock Console — inventory collector
#
# Emits one JSON line per tick describing the live PnP tree, battery, storage,
# network adapters and monitors. Runs as a long-lived child process so the
# expensive enumeration is amortised.
#
#   DOCK_INTERVAL_MS  tick interval (default 2000)
#   DOCK_CACHE        path of the descriptor cache (default <script>/../data/cache.json)
#   DOCK_FALLBACK     1 = skip pnputil, use the WMI path (Windows 10 < 1903)
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# pnputil speaks the OEM code page; JSON goes out as UTF-8 on a separate writer.
[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(936)
$Stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
$Stdout.AutoFlush = $true

$IntervalMs = 2000
if ($env:DOCK_INTERVAL_MS) { $IntervalMs = [int]$env:DOCK_INTERVAL_MS }

$CacheFile = $env:DOCK_CACHE
if (-not $CacheFile) { $CacheFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\cache.json' }
$CacheDir = Split-Path $CacheFile -Parent
if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null }

# ============================ capability ============================
$Mode = 'pnputil'
if ($env:DOCK_FALLBACK -eq '1') {
  $Mode = 'wmi'
} else {
  $probe = & pnputil /? 2>$null
  if (-not ($probe -match '/relations')) { $Mode = 'wmi' }
}

# ============================ static host facts ============================
$cs     = Get-CimInstance Win32_ComputerSystem
$cpu    = Get-CimInstance Win32_Processor | Select-Object -First 1
$osObj  = Get-CimInstance Win32_OperatingSystem
$wmiBat = Get-CimInstance Win32_Battery | Select-Object -First 1
$bootTime = [datetime]$osObj.LastBootUpTime
$HostInfo = [ordered]@{
  name     = $env:COMPUTERNAME
  vendor   = "$($cs.Manufacturer)".Trim()
  model    = "$($cs.Model)".Trim()
  cpu      = "$($cpu.Name)".Trim() -replace '\s+CPU\s+@.*', ''
  cpuFull  = "$($cpu.Name)".Trim()
  cores    = $cpu.NumberOfLogicalProcessors
  ramGB    = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
  os       = "$($osObj.Caption)"
  osBuild  = "$($osObj.BuildNumber)"
  gpu      = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA|Radeon|Arc' } | Select-Object -First 1).Name
  batName  = "$($wmiBat.Name)"
  batDesign= $wmiBat.DesignCapacity
  mode     = $Mode
}

# ============================ caches ============================
$NameCache   = @{}
$ParentCache = @{}
if (Test-Path $CacheFile) {
  try {
    $raw = [IO.File]::ReadAllText($CacheFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($raw.names)   { foreach ($p in $raw.names.PSObject.Properties)   { $NameCache[$p.Name]   = "$($p.Value)" } }
    if ($raw.parents) { foreach ($p in $raw.parents.PSObject.Properties) { $ParentCache[$p.Name] = "$($p.Value)" } }
  } catch { }
}

function Save-Cache {
  try {
    $obj = [ordered]@{ names = $NameCache; parents = $ParentCache }
    [IO.File]::WriteAllText($CacheFile, ($obj | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

# ============================ registry: location info ============================
function Get-UsbRegMap {
  $map = @{}
  $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Enum\USB')
  if (-not $k) { return $map }
  foreach ($vid in $k.GetSubKeyNames()) {
    $vk = $k.OpenSubKey($vid); if (-not $vk) { continue }
    foreach ($inst in $vk.GetSubKeyNames()) {
      $ik = $vk.OpenSubKey($inst)
      if ($ik) {
        $loc = $ik.GetValue('LocationInformation')
        if ($loc) {
          $map[('USB\' + $vid + '\' + $inst).ToLower()] = @{
            loc = "$loc"
            bus = "$($ik.GetValue('BusReportedDeviceDesc'))"
          }
        }
        $ik.Close()
      }
    }
    $vk.Close()
  }
  $k.Close()
  return $map
}

# ============================ enumeration ============================
$LabelMap = @{
  '实例 ID'      = 'id';       'Instance ID' = 'id'
  '设备描述'     = 'desc';     'Device Description' = 'desc'
  '类名'         = 'cls';      'Class Name' = 'cls'
  '类 GUID'      = '_skip1';   'Class GUID' = '_skip1'
  '制造商名称'   = 'mfg';      'Manufacturer Name' = 'mfg'
  '状态'         = 'status';   'Status' = 'status'
  '问题代码'     = 'problem';  'Problem Code' = 'problem'
  '问题状态'     = '_skip2';   'Problem Status' = '_skip2'
  '驱动程序名称' = 'driver';   'Driver Name' = 'driver'
  '父级'         = 'parent';   'Parent' = 'parent'
  '子级'         = 'children'; 'Children' = 'children'
  '硬件 ID'      = '_skip3';   'Hardware IDs' = '_skip3'
  '兼容 ID'      = '_skip4';   'Compatible IDs' = '_skip4'
}

function Get-RawDeviceListPnp {
  $raw = & pnputil /enum-devices /connected /relations 2>$null
  $devs = New-Object System.Collections.ArrayList
  $cur = $null
  $lastKey = $null
  foreach ($line in $raw) {
    if ($null -eq $line) { continue }
    $l = "$line"
    if ($l.Trim().Length -eq 0) { continue }
    if ($l -match '^\s*([^:]{1,22}?)\s*:\s*(.*)$') {
      $lab = $matches[1].Trim()
      $val = $matches[2].Trim()
      $key = $LabelMap[$lab]
      if ($key) {
        if ($key -eq 'id') {
          if ($cur) { [void]$devs.Add([pscustomobject]$cur) }
          $cur = @{ id = $val.ToLower() }
        } elseif ($key -notlike '_skip*' -and $cur) {
          $cur[$key] = $val
        }
        $lastKey = $key
        continue
      }
    }
    if ($cur -and $lastKey -and $lastKey -notlike '_skip*') {
      $cur[$lastKey] = "$($cur[$lastKey])$($l.Trim())"
    }
  }
  if ($cur) { [void]$devs.Add([pscustomobject]$cur) }
  return $devs
}

$FriendlyCls = @('DiskDrive', 'SCSIAdapter', 'CDROM', 'Camera', 'WPD', 'Image', 'USBDevice')

function Get-RawDeviceListWmi {
  $devs = New-Object System.Collections.ArrayList
  $dirty = $false
  # DEVPKEY_Device_Parent costs ~450 ms per device, so resolve a few per tick and
  # cache them forever — after the first few seconds this path is as cheap as pnputil.
  $budget = 4
  foreach ($d in (Get-PnpDevice -PresentOnly)) {
    $id = "$($d.InstanceId)".ToLower()
    if (-not $id.StartsWith('usb\')) {
      if ($FriendlyCls -notcontains "$($d.Class)") { continue }
    }
    $parent = $ParentCache[$id]
    if ($null -eq $parent) {
      if ($budget -le 0) {
        $parent = ''
      } else {
        $p = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_Parent' -ErrorAction SilentlyContinue).Data
        $parent = "$p".ToLower()
        $ParentCache[$id] = $parent
        $dirty = $true
        $budget--
      }
    }
    $status = 'ok'
    if ("$($d.Status)" -notmatch 'OK') { $status = 'problem' }
    $isHubGuess = ("$($d.Class)" -eq 'USB' -and "$($d.FriendlyName)" -match '集线器|Hub')
    [void]$devs.Add([pscustomobject]@{
      id      = $id
      parent  = $parent
      desc    = "$($d.FriendlyName)"
      cls     = "$($d.Class)"
      mfg     = ''
      status  = $status
      problem = ''
      driver  = if ($isHubGuess) { 'usbhub3' } else { '' }
    })
  }
  if ($dirty) { Save-Cache }
  return $devs
}

function Resolve-Names {
  param([string[]]$Ids, [int]$Budget = 4)
  $changed = $false
  foreach ($id in $Ids) {
    if ($Budget -le 0) { break }
    if ($NameCache.ContainsKey($id)) { continue }
    $v = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_BusReportedDeviceDesc' -ErrorAction SilentlyContinue).Data
    $NameCache[$id] = if ($v) { "$v" } else { '' }
    $changed = $true
    $Budget--
  }
  if ($changed) { Save-Cache }
}

function Get-DeviceSnapshot {
  $reg = Get-UsbRegMap
  if ($Mode -eq 'wmi') { $all = Get-RawDeviceListWmi } else { $all = Get-RawDeviceListPnp }

  $unknown = New-Object System.Collections.ArrayList
  foreach ($d in $all) {
    if ($d.id -like 'usb\*' -and -not $d.id.Contains('&mi_') -and -not $NameCache.ContainsKey($d.id)) {
      [void]$unknown.Add($d.id)
    }
  }
  if ($unknown.Count -gt 0) { Resolve-Names -Ids $unknown.ToArray() -Budget 4 }

  $out = New-Object System.Collections.ArrayList
  foreach ($d in $all) {
    if (-not $d.id) { continue }
    $keep = ($d.id -like 'usb\*') -or ($FriendlyCls -contains "$($d.cls)")
    if (-not $keep) { continue }

    $r = $reg[$d.id]
    $vid = ''; $pidNum = ''
    if ($d.id -match 'vid_([0-9a-f]{4})&pid_([0-9a-f]{4})') { $vid = $matches[1].ToUpper(); $pidNum = $matches[2].ToUpper() }

    $statusRaw = "$($d.status)"
    $status = 'ok'
    if ($statusRaw -match '问题|Problem') { $status = 'problem' }
    elseif ($statusRaw -match '停止|Stopped|Disabled') { $status = 'stopped' }

    $loc = ''
    if ($r -and $r.loc -match '^Port_#\d+') { $loc = $r.loc }

    $isHub = $false
    if ("$($d.cls)" -eq 'USB' -and ("$($d.driver)" -match '^usbhub' -or "$($d.desc)" -match '集线器|Hub')) { $isHub = $true }

    $descName = ''
    if ($d.id -like 'usb\*' -and -not $d.id.Contains('&mi_')) { $descName = "$($NameCache[$d.id])" }

    [void]$out.Add([ordered]@{
      id      = $d.id
      parent  = "$($d.parent)".ToLower()
      desc    = "$($d.desc)"
      busname = $descName
      cls     = "$($d.cls)"
      mfg     = "$($d.mfg)"
      status  = $status
      problem = "$($d.problem)"
      driver  = "$($d.driver)"
      loc     = $loc
      isHub   = $isHub
      vid     = $vid
      pid     = $pidNum
    })
  }
  return $out
}

# ============================ battery ============================
function Get-BatterySnapshot {
  $b = Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus
  if (-not $b) { return $null }
  $full = Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity
  $remain  = $b.RemainingCapacity
  $fullCap = if ($full) { $full.FullChargedCapacity } else { $null }
  $design  = $HostInfo.batDesign
  $pct = 0
  if ($fullCap -and $fullCap -gt 0 -and $remain) { $pct = [math]::Round($remain / $fullCap * 100, 0) }
  [ordered]@{
    pct        = [int]$pct
    ac         = [bool]$b.PowerOnline
    volt       = if ($b.Voltage) { [math]::Round($b.Voltage / 1000, 3) } else { $null }
    remainMWh  = $remain
    fullMWh    = $fullCap
    designMWh  = if ($design -and $design -gt 0) { $design } else { $null }
    chargeRate = if ($b.ChargeRate) { $b.ChargeRate } else { 0 }
    disRate    = if ($b.DischargeRate) { $b.DischargeRate } else { 0 }
    health     = if ($design -and $design -gt 0 -and $fullCap) { [math]::Round($fullCap / $design * 100, 0) } else { $null }
  }
}

# ============================ storage ============================
$DiskCache = @{ ts = [datetime]::MinValue; disks = @(); volumes = @() }
function Get-StorageSnapshot {
  if (([datetime]::UtcNow - $DiskCache.ts).TotalSeconds -lt 15) {
    return [ordered]@{ disks = $DiskCache.disks; volumes = $DiskCache.volumes }
  }

  $drives = @(Get-CimInstance Win32_DiskDrive)
  $parts  = @(Get-CimInstance Win32_DiskDriveToDiskPartition)
  $lvols  = @(Get-CimInstance Win32_LogicalDiskToPartition)

  $partToLetter = @{}
  foreach ($m in $lvols) {
    $letter = $null; $key = $null
    if ("$($m.Dependent)"  -match 'DeviceID\s*=\s*"([A-Z]:)"')      { $letter = $matches[1] }
    if ("$($m.Antecedent)" -match 'Disk #(\d+), Partition #(\d+)') { $key = "d$($matches[1])p$($matches[2])" }
    if ($letter -and $key) { $partToLetter[$key] = $letter }
  }

  $diskLetters = @{}
  foreach ($m in $parts) {
    $dnum = $null; $key = $null
    if ("$($m.Antecedent)" -match 'PHYSICALDRIVE(\d+)')            { $dnum = [int]$matches[1] }
    if ("$($m.Dependent)"  -match 'Disk #(\d+), Partition #(\d+)') { $key = "d$($matches[1])p$($matches[2])" }
    if ($null -ne $dnum -and $key -and $partToLetter[$key]) {
      if (-not $diskLetters[$dnum]) { $diskLetters[$dnum] = @() }
      $diskLetters[$dnum] += $partToLetter[$key]
    }
  }

  $disks = @()
  foreach ($d in $drives) {
    $disks += [ordered]@{
      n       = [int]$d.Index
      model   = "$($d.Model)".Trim()
      bus     = "$($d.InterfaceType)"
      sizeGB  = if ($d.Size) { [math]::Round($d.Size / 1GB, 1) } else { 0 }
      media   = "$($d.MediaType)"
      serial  = "$($d.SerialNumber)".Trim()
      letters = @($diskLetters[[int]$d.Index])
      status  = "$($d.Status)"
    }
  }

  $vols = @()
  foreach ($v in (Get-CimInstance Win32_LogicalDisk)) {
    $vols += [ordered]@{
      letter = "$($v.DeviceID)"
      label  = "$($v.VolumeName)".Trim()
      fs     = "$($v.FileSystem)"
      sizeGB = if ($v.Size) { [math]::Round($v.Size / 1GB, 1) } else { 0 }
      freeGB = if ($v.FreeSpace) { [math]::Round($v.FreeSpace / 1GB, 1) } else { 0 }
      type   = switch ($v.DriveType) { 2 { 'Removable' } 3 { 'Fixed' } 4 { 'Network' } 5 { 'CD-ROM' } default { 'Other' } }
    }
  }

  $DiskCache = @{ ts = [datetime]::UtcNow; disks = $disks; volumes = $vols }
  return [ordered]@{ disks = $disks; volumes = $vols }
}

# ============================ network ============================
function Get-NicSnapshot {
  $items = @()
  foreach ($n in (Get-CimInstance -Namespace root\StandardCimv2 -ClassName MSFT_NetAdapter)) {
    $desc = "$($n.InterfaceDescription)"
    if ($desc -match 'WAN Miniport|Kernel Debug') { continue }
    $sp = 0
    if ($n.Speed) { $sp = [double]$n.Speed }
    $speed = '0 bps'
    if ($sp -ge 1e9) { $speed = "{0:N1} Gbps" -f ($sp / 1e9) }
    elseif ($sp -gt 0) { $speed = "{0:N0} Mbps" -f ($sp / 1e6) }
    $items += [ordered]@{
      name   = "$($n.Name)"
      desc   = $desc
      status = if ($n.MediaConnectState -eq 1) { 'Up' } else { 'Disconnected' }
      speed  = $speed
      mac    = "$($n.PermanentAddress)"
      idx    = [int]$n.ifIndex
    }
  }
  return $items
}

# ============================ monitors ============================
$MonCache = @{ ts = [datetime]::MinValue; items = @() }
function Get-MonitorSnapshot {
  if (([datetime]::UtcNow - $MonCache.ts).TotalSeconds -lt 60) { return $MonCache.items }
  $items = @()
  foreach ($m in (Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID)) {
    $name = -join ($m.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
    $mfr  = -join ($m.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
    $items += [ordered]@{
      mfr    = $mfr
      model  = ($name -replace '[\x00-\x1f]', '').Trim()
      year   = $m.YearOfManufacture
      active = [bool]$m.Active
    }
  }
  $MonCache = @{ ts = [datetime]::UtcNow; items = $items }
  return $items
}

# ============================ main loop ============================
$tick = 0
while ($true) {
  $sw = [Diagnostics.Stopwatch]::StartNew()

  $snapshot = [ordered]@{
    type    = 'inv'
    ts      = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    tick    = $tick
    host    = $HostInfo
    uptime  = [int]((Get-Date) - $bootTime).TotalSeconds
    battery = Get-BatterySnapshot
    devices = @(Get-DeviceSnapshot)
  }

  if ($tick % 2 -eq 0) { $snapshot.storage = Get-StorageSnapshot } else { $snapshot.storage = $null }
  if ($tick % 2 -eq 1) { $snapshot.nics = @(Get-NicSnapshot) } else { $snapshot.nics = $null }
  if ($tick % 8 -eq 0) { $snapshot.monitors = @(Get-MonitorSnapshot) } else { $snapshot.monitors = $null }

  $sw.Stop()
  $snapshot.costMs = [int]$sw.ElapsedMilliseconds
  $Stdout.WriteLine(($snapshot | ConvertTo-Json -Depth 8 -Compress))

  $tick++
  $wait = $IntervalMs - $sw.ElapsedMilliseconds
  if ($wait -lt 300) { $wait = 300 }
  Start-Sleep -Milliseconds $wait
}
