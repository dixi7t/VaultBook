<#
  VaultBook <-> QuickBooks Desktop - one script for everything (1.31).

  Double-click "VaultBook QuickBooks.cmd" (same folder) and pick from the menu (1.60 order):
    1  Connect to VaultBook     a link VaultBook talks to directly (1.47, 1.59): VaultBook asks for a fresh export,
                                sends entries or changes and gets the result back; you still answer Y/N here.
    2  QuickBooks -> VaultBook  (Export) lists and every transaction, to build or refresh the company in VaultBook.
    3  VaultBook -> QuickBooks  (Send) you choose the file VaultBook made: invoices, customer payments, bank
                                transactions (checks, deposits, transfers, card charges and credits, journal
                                entries) or an update file. It checks every item against QuickBooks, skips what is
                                already there, asks before creating any customer or item, asks once more, then
                                records and saves a .result.json next to the file.
    4  Preview a VaultBook file (Check) shows the plan for a file, writes nothing.
    5  What QuickBooks has      (Read) what the open company file holds, by month, saved as a snapshot. Nothing is
                                written. Load it in VaultBook: Send to QuickBooks.
    6  Reports to Excel         a bank or any account's ledger, the general ledger, the transaction list, Profit
                                and Loss, Balance Sheet, Trial Balance, open invoices, unpaid bills, for any dates,
                                saved as .csv for Excel. Nothing is written to QuickBooks; VaultBook is not needed.
    7  Set up one-click open    one time: lets VaultBook open this window (Open the QuickBooks tool). No admin rights.
    8  Remove what VaultBook sent  (Remove, 1.63) for dates you choose, deletes from QuickBooks only entries that carry
                                [VB:...] in the memo (recorded by this tool). Lists them, asks you to type DELETE, saves
                                a .result.json; loaded in VaultBook, those entries count as not sent again.
    -Mode Cycle                 (not on the menu) snapshot, send the file, snapshot again.
    Update files (1.47)         a VaultBook file made under Update QuickBooks holds only what changed in VaultBook:
                                line accounts, amounts, memos, dates, numbers, payees, and voids. Each edit carries
                                QuickBooks' EditSequence: an entry changed in QuickBooks since the export is refused.
                                Nothing is ever deleted; a transaction voided in VaultBook is voided in QuickBooks.
  The script never searches for files: it always asks you to choose them (Open File window, or type a path).
  Results and snapshots are saved next to the file you chose (snapshots: next to the last file, or where you say).

  First run only: open the company file as the QuickBooks Admin in single-user mode; when QuickBooks asks whether to
  let "VaultBook Connector" use the file, choose "Yes, always" and log in as Admin. Windows administrator rights are
  not needed. Each transaction the script records carries its VaultBook id in the memo as [VB:...] so a later Read
  recognizes it exactly; hand-typed entries are matched by type, date, number and amount.
#>
param(
  [ValidateSet('', 'Read', 'Send', 'Cycle', 'Check', 'Export', 'Reports', 'Link', 'InstallLink', 'Remove')][string]$Mode = '',
  [int]$Port = 47321,
  [string]$Batch = '',
  [string]$SnapshotTo = '',
  [string]$From = '',
  [string]$To = '',
  [switch]$Yes,                         # answer Y to every question (unattended)
  [switch]$Linked,                      # started by the VaultBook link: the result goes back to VaultBook
  [string]$AppName = 'VaultBook Connector'
)
$ErrorActionPreference = 'Stop'
if ($From -eq 'all') { $From = '' }   # the 32-bit relaunch passes "all" because empty arguments are dropped
$inv = [Globalization.CultureInfo]::InvariantCulture
$lastDirFile = Join-Path $env:LOCALAPPDATA 'VaultBook\qb-last-folder.txt'
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

# ---------- classic full-screen console look (box frame, menu bar, status line, progress bars) ----------
# The source stays ASCII (Windows PowerShell reads .ps1 files as ANSI); box characters are built from code points.
$script:FancyOK = $true
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $null = [Console]::WindowWidth; if ([Console]::IsOutputRedirected) { $script:FancyOK = $false } } catch { $script:FancyOK = $false }
$B = @{ TL = [char]0x2554; TR = [char]0x2557; BL = [char]0x255A; BR = [char]0x255D; H = [char]0x2550; V = [char]0x2551; LT = [char]0x2560; RT = [char]0x2563
        stl = [char]0x250C; str = [char]0x2510; sbl = [char]0x2514; sbr = [char]0x2518; sh = [char]0x2500; sv = [char]0x2502; Full = [char]0x2588; Light = [char]0x2591; Ptr = [char]0x25BA; Dot = [char]0x2022 }
if (-not $script:FancyOK) { $B = @{ TL = '+'; TR = '+'; BL = '+'; BR = '+'; H = '='; V = '|'; LT = '+'; RT = '+'; stl = '+'; str = '+'; sbl = '+'; sbr = '+'; sh = '-'; sv = '|'; Full = '#'; Light = '.'; Ptr = '>'; Dot = '*' } }
function W() { try { [Math]::Max(60, [Math]::Min(100, [Console]::WindowWidth - 1)) } catch { 80 } }
function Pad([string]$t, [int]$n) { if ($t.Length -gt $n) { $t.Substring(0, $n) } else { $t + (' ' * ($n - $t.Length)) } }
function Line([string]$left, [string]$mid, [string]$right, [string]$fill, [string]$fg = 'Cyan', [string]$bg = 'DarkBlue') {
  $w = W; Write-Host ($left + (Pad $mid ($w - 2)).Replace(' ', $fill) + $right) -ForegroundColor $fg -BackgroundColor $bg
}
function Row([string]$text, [string]$fg = 'White', [string]$bg = 'DarkBlue') {
  $w = W; Write-Host $B.V -ForegroundColor Cyan -BackgroundColor $bg -NoNewline; Write-Host (Pad (' ' + $text) ($w - 2)) -ForegroundColor $fg -BackgroundColor $bg -NoNewline; Write-Host $B.V -ForegroundColor Cyan -BackgroundColor $bg
}
function Banner([string]$sub = '') {
  if ($script:FancyOK) { try { Clear-Host } catch { } }
  $w = W; $title = 'V A U L T B O O K   ' + $B.Dot + '   Q U I C K B O O K S   D E S K T O P   C O N N E C T O R'
  Line $B.TL ('' ) $B.TR $B.H
  if ($title.Length -gt $w - 4) { $title = 'VAULTBOOK ' + $B.Dot + ' QUICKBOOKS DESKTOP CONNECTOR' }
  $t2 = 'Offline bridge between VaultBook and QuickBooks'
  Row ((' ' * [Math]::Max(0, [int](($w - 2 - $title.Length) / 2) - 1)) + $title) 'Yellow'
  Row ((' ' * [Math]::Max(0, [int](($w - 2 - $t2.Length) / 2) - 1)) + $t2) 'Gray'
  Line $B.LT '' $B.RT $B.H
  $now = (Get-Date).ToString('ddd dd-MMM-yyyy  HH:mm')
  Row ((Pad ('Status: ' + $(if ($sub) { $sub } else { 'Ready' })) ($w - 28)) + $now) 'White'
  Line $B.BL '' $B.BR $B.H
  Write-Host ''
}
function Section([string]$t) {
  $w = W; Write-Host ''; Write-Host (' ' + $B.stl + $B.sh + ' ' + $t + ' ' + ([string]$B.sh * [Math]::Max(2, $w - $t.Length - 7)) + $B.str) -ForegroundColor Cyan
}
function Bar([int]$done, [int]$total, [int]$width = 28) {
  if ($total -le 0) { return ([string]$B.Light * $width) }
  $k = [Math]::Min($width, [int]([Math]::Floor($width * $done / $total))); ([string]$B.Full * $k) + ([string]$B.Light * ($width - $k))
}
function Progress([string]$label, [int]$step, [int]$steps, [string]$count) {
  $line = ('  ' + (Pad $label 24) + ' ' + (Bar $step $steps) + ' ' + $count)
  Write-Host ("`r" + (Pad $line ((W) - 1))) -NoNewline -ForegroundColor Gray
}
function Done([string]$label, [string]$count, [string]$c = 'Gray') { Write-Host ("`r" + (Pad ('  ' + (Pad $label 24) + ' ' + ([string]$B.Full * 28) + ' ' + $count) ((W) - 1))) -ForegroundColor $c }
function Box([string[]]$lines, [string]$fg = 'White', [string]$bg = 'DarkBlue', [string]$title = '') {
  $max = (W) - 8; $lines = @(foreach ($l in $lines) { $t2 = "$l"; if (-not $t2) { '' }; while ($t2) { $n = [Math]::Min($max, $t2.Length); $t2.Substring(0, $n); $t2 = $t2.Substring($n) } })
  $w = [Math]::Min((W) - 4, [Math]::Max(40, ($lines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum + 4))
  $t = if ($title) { ' ' + $title + ' ' } else { '' }
  Write-Host ('  ' + $B.stl + $t + ([string]$B.sh * ($w - 2 - $t.Length)) + $B.str) -ForegroundColor $fg -BackgroundColor $bg
  foreach ($l in $lines) { Write-Host ('  ' + $B.sv + ' ' + (Pad $l ($w - 4)) + ' ' + $B.sv) -ForegroundColor $fg -BackgroundColor $bg }
  Write-Host ('  ' + $B.sbl + ([string]$B.sh * ($w - 2)) + $B.sbr) -ForegroundColor $fg -BackgroundColor $bg
}
function Ask([string]$q) {
  if ($Yes) { Say "  $q  -> Yes (all answers Yes)" DarkGray; return $true }
  Write-Host ''
  Write-Host ' ? ' -ForegroundColor Black -BackgroundColor Yellow -NoNewline; Write-Host (' ' + $q + ' ') -ForegroundColor Yellow -NoNewline
  Write-Host '[Y]' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host ' / ' -NoNewline; Write-Host '[N]' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host ' ' -NoNewline
  while ($true) {
    $k = $null
    if ($script:FancyOK) { try { $k = [Console]::ReadKey($true).KeyChar } catch { $k = $null } }
    if ($null -eq $k) { $k = (Read-Host)[0] }
    if ("$k" -match '^[Yy]$') { Write-Host 'Yes' -ForegroundColor Green; return $true }
    if ("$k" -match '^[Nn]$') { Write-Host 'No' -ForegroundColor Red; return $false }
  }
}
function Menu([array]$items, [string]$title = 'MAIN MENU') {
  # items: @(@('1','Title','description'), ...). Arrow keys move the bar, Enter or the number chooses, Esc quits.
  $sel = 0
  if (-not $script:FancyOK) {
    foreach ($it in $items) { Say (' ' + $it[0] + '  ' + (Pad $it[1] 26) + $it[2]) }
    while ($true) { $a = Read-Host ('Choose 1-' + $items.Count + ' (Enter to quit)'); if (-not $a) { return $null }; foreach ($it in $items) { if ($it[0] -eq $a) { return $a } } }
  }
  $top = [Console]::CursorTop
  while ($true) {
    [Console]::SetCursorPosition(0, $top)
    $w = W
    Write-Host ('  ' + $B.stl + ' ' + $title + ' ' + ([string]$B.sh * [Math]::Max(1, $w - 8 - $title.Length)) + $B.str) -ForegroundColor Cyan
    for ($i = 0; $i -lt $items.Count; $i++) {
      $it = $items[$i]; $text = Pad ('  ' + $it[0] + '   ' + (Pad $it[1] 24) + $it[2]) ($w - 9)
      Write-Host ('  ' + $B.sv + ' ') -ForegroundColor Cyan -NoNewline
      if ($i -eq $sel) { Write-Host ($B.Ptr + $text) -ForegroundColor Black -BackgroundColor Yellow -NoNewline }
      else { Write-Host (' ' + $text) -ForegroundColor White -NoNewline }
      Write-Host (' ' + $B.sv) -ForegroundColor Cyan
    }
    Write-Host ('  ' + $B.sbl + ([string]$B.sh * ($w - 6)) + $B.sbr) -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  ' -NoNewline
    foreach ($hint in @(@('Up/Down', 'Move'), @('Enter', 'Select'), @('1-' + $items.Count, 'Quick pick'), @('Esc', 'Quit'))) {
      Write-Host (' ' + $hint[0] + ' ') -ForegroundColor Black -BackgroundColor Cyan -NoNewline; Write-Host (' ' + $hint[1] + '   ') -ForegroundColor Gray -NoNewline
    }
    Write-Host ''
    $k = [Console]::ReadKey($true)
    switch ($k.Key) {
      'UpArrow' { $sel = ($sel - 1 + $items.Count) % $items.Count }
      'DownArrow' { $sel = ($sel + 1) % $items.Count }
      'Home' { $sel = 0 }
      'End' { $sel = $items.Count - 1 }
      'Enter' { return $items[$sel][0] }
      'Escape' { return $null }
      default { foreach ($it in $items) { if ($it[0] -eq "$($k.KeyChar)") { return $it[0] } } }
    }
  }
}
function X([string]$s) {
  # 1.60.1: QuickBooks reads Latin-1 only and refuses the whole request ("error when parsing the provided XML text
  # stream") on one character beyond it, such as a long dash. Plain forms for the usual marks, a space for the rest.
  $t = [System.Security.SecurityElement]::Escape($s); if (-not $t) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $t.ToCharArray()) {
    $n = [int]$ch
    if ($n -ge 32 -and $n -le 126) { [void]$sb.Append($ch) }
    elseif ($n -ge 0x2010 -and $n -le 0x2015) { [void]$sb.Append('-') }
    elseif ($n -eq 0x2018 -or $n -eq 0x2019) { [void]$sb.Append('&apos;') }
    elseif ($n -eq 0x201C -or $n -eq 0x201D) { [void]$sb.Append('&quot;') }
    elseif ($n -eq 0x2026) { [void]$sb.Append('...') }
    elseif ($n -ge 161 -and $n -le 255) { [void]$sb.Append('&#' + $n + ';') }
    else { [void]$sb.Append(' ') }
  }
  $sb.ToString()
}
function Cents($v) { if ($null -eq $v -or "$v" -eq '') { return [int64]0 }; [int64][math]::Round([decimal]::Parse([string]$v, $inv) * 100) }
function Money([int64]$c) { ([decimal]$c / 100).ToString('0.00', $inv) }


# JSON without ConvertTo-Json's quirks (Windows PowerShell fails on some nested collections with "Argument types do not match")
function JStr([string]$v) { '"' + ($v.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')) + '"' }
function ToJson($v, [int]$depth = 0) {
  if ($null -eq $v) { return 'null' }
  if ($v -is [string]) { return JStr $v }
  if ($v -is [bool]) { return $(if ($v) { 'true' } else { 'false' }) }
  if ($v -is [int] -or $v -is [int64] -or $v -is [double] -or $v -is [decimal]) { return ([string]$v) }
  if ($v -is [System.Collections.IDictionary]) { return '{' + (($v.Keys | ForEach-Object { (JStr "$_") + ':' + (ToJson $v[$_] ($depth + 1)) }) -join ',') + '}' }
  if ($v -is [System.Collections.IEnumerable]) { return '[' + (@($v | ForEach-Object { ToJson $_ ($depth + 1) }) -join ',') + ']' }
  if ($v -is [pscustomobject]) { return '{' + (($v.PSObject.Properties | ForEach-Object { (JStr $_.Name) + ':' + (ToJson $_.Value ($depth + 1)) }) -join ',') + '}' }
  JStr ([string]$v)
}
function Mark([string]$memo, [string]$key) { $m = "$memo"; if ($key -and $m -notmatch '\[VB:') { $m = ($m + " [VB:$key]").Trim() }; $m }
function LastDir() { if (Test-Path -LiteralPath $lastDirFile) { $d = ''; try { $d = [IO.File]::ReadAllText($lastDirFile).Trim() } catch { }; if ($d -and (Test-Path -LiteralPath $d)) { return $d } }; $null }
function SaveDir([string]$path) { try { New-Item -ItemType Directory -Force -Path (Split-Path $lastDirFile) | Out-Null; [IO.File]::WriteAllText($lastDirFile, (Split-Path $path)) } catch { } }
function PickFile([string]$title, [string]$filter) {
  $f = $null
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog; $dlg.Title = $title; $dlg.Filter = $filter
    $d = LastDir; if ($d) { $dlg.InitialDirectory = $d }
    $own = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }   # keeps the window in front of the console
    if ($dlg.ShowDialog($own) -eq 'OK') { $f = $dlg.FileName }
  } catch { }
  if (-not $f) { $f = Read-Host "$title`nType or paste the full path (or press Enter to quit)" }
  if ($f) { $f = $f.Trim('"') }
  $f
}
function PickFolder([string]$title) {
  $d = $null
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog; $dlg.Description = $title
    $ld = LastDir; if ($ld) { $dlg.SelectedPath = $ld }
    $own = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
    if ($dlg.ShowDialog($own) -eq 'OK') { $d = $dlg.SelectedPath }
  } catch { }
  if (-not $d) { $d = Read-Host "$title`nType or paste a folder path (or press Enter to quit)" }
  if ($d) { $d = $d.Trim('"') }
  $d
}

# ---- the VaultBook link (1.47): VaultBook talks to this window over 127.0.0.1 only, with a code shown here ----
function LinkReply($stream, [int]$code, [string]$body) {
  $b = [Text.Encoding]::UTF8.GetBytes($body)
  $word = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 500 = 'Error' }[$code]
  $h = "HTTP/1.1 $code $word`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($b.Length)`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($h); $stream.Write($hb, 0, $hb.Length); if ($b.Length) { $stream.Write($b, 0, $b.Length) }; $stream.Flush()
}
function LinkRead($stream) {
  $buf = New-Object System.IO.MemoryStream; $one = New-Object byte[] 1; $tail = ''
  while ($true) {
    $n = $stream.Read($one, 0, 1); if ($n -le 0) { return $null }
    $buf.WriteByte($one[0]); $tail += [char]$one[0]; if ($tail.Length -gt 4) { $tail = $tail.Substring($tail.Length - 4) }
    if ($tail -eq "`r`n`r`n") { break }; if ($buf.Length -gt 65536) { return $null }
  }
  $lines = [Text.Encoding]::ASCII.GetString($buf.ToArray()) -split "`r`n"; $first = $lines[0] -split ' '; $hdr = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) { $c = $lines[$i].IndexOf(':'); if ($c -gt 0) { $hdr[$lines[$i].Substring(0, $c).Trim()] = $lines[$i].Substring($c + 1).Trim() } }
  $len = 0; if ($hdr['Content-Length']) { $len = [int]$hdr['Content-Length'] }
  if ($len -gt 209715200) { return $null }
  $body = New-Object byte[] $len; $got = 0
  while ($got -lt $len) { $n = $stream.Read($body, $got, $len - $got); if ($n -le 0) { break }; $got += $n }
  [pscustomobject]@{ method = $first[0]; path = $(if ($first.Count -gt 1) { $first[1] } else { '' }); headers = $hdr; body = [Text.Encoding]::UTF8.GetString($body, 0, $got) }
}
function RunLink() {
  $code = '{0:D6}' -f (Get-Random -Minimum 0 -Maximum 1000000)
  $dir = Join-Path $env:LOCALAPPDATA 'VaultBook\link'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $Port)
  try { $l.Start() } catch { Box @("Port $Port is in use. Is the VaultBook link already open in another window?") 'White' 'DarkRed' 'PROBLEM'; return }
  Box @('VaultBook can now talk to this window (this computer only).', '', "LINK CODE:  $code", '',
        'In VaultBook, type this code on Send to QuickBooks > By date', 'or on Update QuickBooks.',
        'Keep QuickBooks open with the company file. Close this window to stop the link.') 'Black' 'Cyan' 'VAULTBOOK LINK'
  $me = $PSCommandPath; $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  while ($true) {
    $c = $l.AcceptTcpClient(); $st = $c.GetStream(); $st.ReadTimeout = 30000
    try {
      $rq = LinkRead $st
      if (-not $rq) { continue }
      $hostH = "$($rq.headers['Host'])"
      if ($hostH -ne "127.0.0.1:$Port" -and $hostH -ne "localhost:$Port") { LinkReply $st 403 '{"ok":false,"error":"wrong host"}'; continue }
      if ($rq.method -eq 'OPTIONS') { LinkReply $st 204 ''; continue }
      if ($rq.method -eq 'GET' -and $rq.path -eq '/hello') { LinkReply $st 200 ('{"ok":true,"app":"VaultBook QuickBooks","version":"1.61","port":' + $Port + '}'); continue }
      if ($rq.method -ne 'POST' -or $rq.path -ne '/run') { LinkReply $st 404 '{"ok":false,"error":"not found"}'; continue }
      $j = $null; try { $j = $rq.body | ConvertFrom-Json } catch { }
      if (-not $j -or "$($j.code)" -ne $code) { Say '  A request came with the wrong link code: refused.' Yellow; LinkReply $st 403 '{"ok":false,"error":"wrong link code"}'; continue }
      $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
      if ("$($j.action)" -eq 'export') {
        Say ''; Say "  VaultBook asked for a fresh QuickBooks export ($((Get-Date).ToString('HH:mm')))." Cyan
        $sub = Join-Path $dir "export-$stamp"; New-Item -ItemType Directory -Force -Path $sub | Out-Null
        & $ps -NoProfile -ExecutionPolicy Bypass -File $me -Mode Export -SnapshotTo $sub -From all -Linked -AppName $AppName
        $f = Get-ChildItem -LiteralPath $sub -Filter 'VaultBook-QB-full-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($f) { LinkReply $st 200 ([IO.File]::ReadAllText($f.FullName)) } else { LinkReply $st 500 '{"ok":false,"error":"the export did not finish: is QuickBooks open with the company file?"}' }
      }
      elseif ("$($j.action)" -eq 'apply') {
        Say ''; Say "  VaultBook sent changes ($((Get-Date).ToString('HH:mm'))). Answer the questions below." Cyan
        $bf = Join-Path $dir "VaultBook-QB-update-$stamp.json"
        [IO.File]::WriteAllText($bf, "$($j.batchText)", (New-Object System.Text.UTF8Encoding $false))
        # 1.61: VaultBook sends a long list in parts; the questions were answered for the first part, the others carry yes
        if ($j.yes -eq $true) { & $ps -NoProfile -ExecutionPolicy Bypass -File $me -Mode Send -Batch $bf -Linked -Yes -AppName $AppName }
        else { & $ps -NoProfile -ExecutionPolicy Bypass -File $me -Mode Send -Batch $bf -Linked -AppName $AppName }
        $rf = Join-Path $dir "VaultBook-QB-update-$stamp.result.json"
        if (Test-Path -LiteralPath $rf) { LinkReply $st 200 ([IO.File]::ReadAllText($rf)) } else { LinkReply $st 500 '{"ok":false,"error":"nothing was recorded (no result file)"}' }
      }
      else { LinkReply $st 400 '{"ok":false,"error":"unknown action"}' }
      Say '  Done. Waiting for VaultBook... (close this window to stop the link)' DarkGray
    } catch { Say "  Link problem: $($_.Exception.Message)" Red; try { LinkReply $st 500 '{"ok":false,"error":"link problem"}' } catch { } }
    finally { try { $c.Close() } catch { } }
  }
}
function InstallLink() {
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $cmd = '"' + $ps + '" -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Mode Link'
  $k = 'HKCU:\Software\Classes\vaultbook-qb'
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:VaultBook QuickBooks link'
  Set-ItemProperty -Path $k -Name 'URL Protocol' -Value ''
  New-Item -Path "$k\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path "$k\shell\open\command" -Name '(default)' -Value $cmd
  Box @('Installed for this Windows user (no admin rights used).', '', 'In VaultBook, "Open the QuickBooks tool" now opens this tool', 'in link mode; the browser asks once whether to open it.', '', 'If you move this folder, run 7 again.') 'White' 'DarkGreen' 'LINK INSTALLED'
}

# ---- menu ----
if (-not $Mode) {
  Banner 'Waiting for your choice'
  Box @('1. Open the company file in QuickBooks Desktop.',
        '2. In QuickBooks choose Window > Close All (open reports slow every entry).',
        'First time only: log in as Admin in single-user mode and choose',
        '"Yes, always" when QuickBooks asks about VaultBook Connector.') 'Gray' 'Black' 'BEFORE YOU START'
  Write-Host ''
  # 1.60: the menu follows what the user wants to do. Connect first (VaultBook does the rest), then one line per
  # direction, then the helpers. "Read, send, read" left the menu; -Mode Cycle still runs it.
  $pick = Menu @(
    @('1', 'Connect to VaultBook', 'Easiest. VaultBook sends and reads by itself'),
    @('2', 'QuickBooks -> VaultBook', 'First time: copy QuickBooks into a file for VaultBook'),
    @('3', 'VaultBook -> QuickBooks', 'Record a VaultBook file. Duplicates are skipped'),
    @('4', 'Preview a VaultBook file', 'See what a file would record. Nothing is written'),
    @('5', 'What QuickBooks has', 'Snapshot by month, to compare. Nothing is written'),
    @('6', 'Reports to Excel', 'Ledgers, P&L, balance sheet as Excel files'),
    @('7', 'Set up one-click open', 'One time: VaultBook can open this tool by itself'),
    @('8', 'Remove what VaultBook sent', 'Delete from QuickBooks what this tool recorded, for dates you choose'))
  switch ("$pick") { '1' { $Mode = 'Link' } '2' { $Mode = 'Export' } '3' { $Mode = 'Send' } '4' { $Mode = 'Check' } '5' { $Mode = 'Read' } '6' { $Mode = 'Reports' } '7' { $Mode = 'InstallLink' } '8' { $Mode = 'Remove' } default { Say ''; Say '  Goodbye.' DarkGray; exit 0 } }
}
$ModeName = @{ Remove = 'Removing what VaultBook sent'; Read = 'Reading QuickBooks'; Send = 'Sending to QuickBooks'; Cycle = 'Read - send - read'; Check = 'Checking a file (nothing written)'; Export = 'Exporting everything from QuickBooks'; Reports = 'Reports and ledgers from QuickBooks'; Link = 'Connected to VaultBook'; InstallLink = 'Installing the VaultBook link' }[$Mode]
Banner $ModeName
if ($Mode -eq 'InstallLink') { InstallLink; exit 0 }
if ($Mode -eq 'Link') { RunLink; exit 0 }
$CheckOnly = $Mode -eq 'Check'
$doSend = $Mode -eq 'Send' -or $Mode -eq 'Cycle' -or $Mode -eq 'Check'
$doRead = $Mode -eq 'Read' -or $Mode -eq 'Cycle'
$doExport = $Mode -eq 'Export'
$doReports = $Mode -eq 'Reports'
$doRemove = $Mode -eq 'Remove'

# ---- the file to send ----
$data = $null; $invoices = @(); $payments = @(); $bank = @(); $updates = @(); $voids = @()
if ($doSend) {
  if (-not $Batch) { $Batch = PickFile 'Choose the file from VaultBook (Banking > Send to QuickBooks > Download for QuickBooks)' 'VaultBook files for QuickBooks (VaultBook-QB-*.json)|VaultBook-QB-*.json|JSON files (*.json)|*.json|All files (*.*)|*.*' }
  if (-not $Batch) { Say 'No file chosen. Nothing was done.' Yellow; exit 2 }
  if (-not (Test-Path -LiteralPath $Batch)) { Say "File not found: $Batch" Red; exit 2 }
  $Batch = (Resolve-Path -LiteralPath $Batch).Path; SaveDir $Batch
  $data = Get-Content -LiteralPath $Batch -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($data.format -ne 'vaultbook-qb-batch') { Say 'This is not a VaultBook batch file.' Red; exit 2 }
  if ($data.invoices) { $invoices = @($data.invoices) }
  if ($data.payments) { $payments = @($data.payments) }
  if ($data.bank) { $bank = @($data.bank) }
  if ($data.updates) { $updates = @($data.updates) }
  if ($data.voids) { $voids = @($data.voids) }
}
# ---- where the snapshot / export goes ----
$snapDir = ''
if ($doExport) {
  $snapDir = $SnapshotTo
  if (-not $snapDir) { $snapDir = PickFolder 'Choose the folder where the full QuickBooks export should be saved (you will import it in VaultBook)' }
  if (-not $snapDir) { Say 'No folder chosen. Nothing was done.' Yellow; exit 2 }
  if (-not (Test-Path -LiteralPath $snapDir)) { New-Item -ItemType Directory -Force -Path $snapDir | Out-Null }
  $snapDir = (Resolve-Path -LiteralPath $snapDir).Path; SaveDir (Join-Path $snapDir 'x')
  if (-not $From -and -not $Yes -and -not $SnapshotTo) { $From = Read-Host 'Export from date (YYYY-MM-DD), or press Enter for all dates' }
  if ($From -and $From -notmatch '^\d{4}-\d{2}-\d{2}$') { Say "Not a date: $From" Red; exit 2 }
  if (-not $To) { $To = (Get-Date).ToString('yyyy-MM-dd') }
}
if ($doRead) {
  if ($SnapshotTo) { $snapDir = $SnapshotTo }
  elseif ($Batch) { $snapDir = Split-Path $Batch }
  else { $snapDir = PickFolder 'Choose the folder where the QuickBooks snapshot should be saved (you will load it in VaultBook)' }
  if (-not $snapDir) { Say 'No folder chosen. Nothing was done.' Yellow; exit 2 }
  if (-not (Test-Path -LiteralPath $snapDir)) { New-Item -ItemType Directory -Force -Path $snapDir | Out-Null }
  $snapDir = (Resolve-Path -LiteralPath $snapDir).Path; SaveDir (Join-Path $snapDir 'x')
  if (-not $From) { $From = (Get-Date).AddYears(-5).ToString('yyyy') + '-01-01' }
  if (-not $To) { $To = (Get-Date).ToString('yyyy-MM-dd') }
}

# ---- QuickBooks SDK (QBXMLRP2 may be registered for 32-bit programs only) ----
try { $rp = New-Object -ComObject QBXMLRP2.RequestProcessor }
catch {
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  if ([IntPtr]::Size -eq 8 -and (Test-Path $ps32)) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Mode', $Mode, '-AppName', $AppName)
    if ($Linked) { $a += '-Linked' }; if ($Mode -eq 'Link') { $a += @('-Port', $Port) }
    if ($Batch) { $a += @('-Batch', $Batch) }; if ($snapDir) { $a += @('-SnapshotTo', $snapDir) }; if ($From) { $a += @('-From', $From) } elseif ($doExport) { $a += @('-From', 'all') }; if ($To) { $a += @('-To', $To) }; if ($Yes) { $a += '-Yes' }
    & $ps32 @a; exit $LASTEXITCODE
  }
  Say 'The QuickBooks SDK (QBXMLRP2) is not on this PC. Run this on the PC where QuickBooks Desktop is installed.' Red; exit 2
}

if ($data) { Say "File: $Batch"; Say "Company: $($data.company)   Invoices: $($invoices.Count)   Payments: $($payments.Count)   Bank transactions: $($bank.Count)   Edits: $($updates.Count)   Voids: $($voids.Count)   (made $($data.createdAt))"; if ($data.snapshotAt) { Say "Compared with the QuickBooks export of $($data.snapshotAt)" }; Say '' }

function Send([string]$body) {
  $xml = '<?xml version="1.0" encoding="utf-8"?><?qbxml version="13.0"?><QBXML><QBXMLMsgsRq onError="continueOnError">' + $body + '</QBXMLMsgsRq></QBXML>'
  $resp = [regex]::Replace($script:rp.ProcessRequest($script:ticket, $xml), '[\x00-\x08\x0B\x0C\x0E-\x1F]|&#(x0*([0-8bBcCeEfF]|1[0-9a-fA-F])|0*([0-8]|1[124-9]|2[0-9]|3[01]));', ' ')   # characters XML cannot hold (pasted memos)
  ([xml]$resp).QBXML.QBXMLMsgsRs
}
function Ok($rs) { $null -ne $rs -and ($rs.statusCode -eq '0' -or $rs.statusCode -eq '1') }

$results = New-Object System.Collections.Generic.List[object]
function KeyOf($x) { if ($x.i) { $x.i.key } elseif ($x.p) { $x.p.key } elseif ($x.u) { $x.u.key } elseif ($x.v) { $x.v.key } else { $x.b.key } }
function KindOf($x) { if ($x.i) { 'invoice' } elseif ($x.p) { 'payment' } elseif ($x.u) { 'update' } elseif ($x.v) { 'void' } else { 'bank' } }
function Note($key, $kind, $label, $status, $txn, $details) { $script:results.Add([pscustomobject]@{ key = $key; kind = $kind; label = $label; status = $status; txnId = $txn; details = $details }) }


# ---- Read QuickBooks: every transaction type in the period, by month ----
# qbXML query -> (ret element, VaultBook-side name). Amount fields differ per type.
$QTYPES = @(
  @('InvoiceQueryRq','InvoiceRet','Invoice','Subtotal'), @('SalesReceiptQueryRq','SalesReceiptRet','SalesReceipt','Subtotal'),
  @('ReceivePaymentQueryRq','ReceivePaymentRet','ReceivePayment','TotalAmount'), @('CreditMemoQueryRq','CreditMemoRet','CreditMemo','Subtotal'),
  @('ARRefundCreditCardQueryRq','ARRefundCreditCardRet','ARRefundCreditCard','TotalAmount'),
  @('BillQueryRq','BillRet','Bill','AmountDue'), @('BillPaymentCheckQueryRq','BillPaymentCheckRet','BillPaymentCheck','Amount'),
  @('BillPaymentCreditCardQueryRq','BillPaymentCreditCardRet','BillPaymentCreditCard','Amount'), @('VendorCreditQueryRq','VendorCreditRet','VendorCredit','CreditAmount'),
  @('CheckQueryRq','CheckRet','Check','Amount'), @('CreditCardChargeQueryRq','CreditCardChargeRet','CreditCardCharge','Amount'),
  @('CreditCardCreditQueryRq','CreditCardCreditRet','CreditCardCredit','Amount'), @('DepositQueryRq','DepositRet','Deposit','DepositTotal'),
  @('TransferQueryRq','TransferRet','Transfer','Amount'), @('JournalEntryQueryRq','JournalEntryRet','JournalEntry','')
)
function JournalAmount($ret) { $s = [int64]0; foreach ($n in $ret.ChildNodes) { if ($n.LocalName -eq 'JournalDebitLine' -and $n.Amount) { $s += Cents $n.Amount } }; Money $s }
function DoRead([string]$stamp) {
  Section 'READING EVERY TRANSACTION TYPE'; $script:qi = 0
  $txns = New-Object System.Collections.Generic.List[object]; $months = @{}
  foreach ($q in $QTYPES) {
    $rq = $q[0]; $retName = $q[1]; $type = $q[2]; $amtField = $q[3]
    $extra = if ($type -eq 'JournalEntry') { '<IncludeLineItems>true</IncludeLineItems>' } else { '' }   # journal totals come from the lines
    $body = "<$rq><TxnDateRangeFilter><FromTxnDate>$From</FromTxnDate><ToTxnDate>$To</ToTxnDate></TxnDateRangeFilter>$extra</$rq>"
    $rs = (Send $body).ChildNodes | Select-Object -First 1
    if (-not $rs -or -not (Ok $rs)) { Done $type ('skipped: ' + $(if ($rs) { $rs.statusMessage } else { 'no answer' })) DarkYellow; continue }
    $n = 0
    foreach ($ret in @($rs.ChildNodes)) {
      if ($ret.LocalName -ne $retName) { continue }
      $amt = if ($amtField) { "$($ret.$amtField)" } else { JournalAmount $ret }
      if (-not $amt) { $amt = '0.00' }
      $name = ''; foreach ($f in 'CustomerRef', 'VendorRef', 'PayeeEntityRef', 'EntityRef') { if ($ret.$f -and $ret.$f.FullName) { $name = $ret.$f.FullName; break } }
      $memo = "$($ret.Memo)"; $key = ''; if ($memo -match '\[VB:([^\]]+)\]') { $key = $Matches[1] }
      $date = "$($ret.TxnDate)".Substring(0, 10)
      $txns.Add([pscustomobject]@{ txnId = "$($ret.TxnID)"; type = $type; date = $date; num = "$($ret.RefNumber)"; name = $name; amount = (Money (Cents $amt)); key = $key })
      $mk = $date.Substring(0, 7); $months[$mk] = [int]$months[$mk] + 1; $n++
    }
    $script:qi++; Done $type ("{0,7}" -f $n) $(if ($n) { 'White' } else { 'DarkGray' })
  }
  $mlist = @($months.Keys | Sort-Object | ForEach-Object { [pscustomobject]@{ month = $_; count = [int]$months[$_] } })
  $co = ''; try { $c = (Send '<CompanyQueryRq/>').CompanyQueryRs; if ($c -and $c.CompanyRet) { $co = "$($c.CompanyRet.CompanyName)" } } catch { }
  $snap = [pscustomobject]@{ format = 'vaultbook-qb-snapshot'; version = 1; company = $co; at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); from = $From; to = $To; txns = @($txns.ToArray()); months = $mlist }
  $safe = ($co -replace '[^\w\- ]+', '').Trim() -replace '\s+', '-'; if (-not $safe) { $safe = 'company' }
  $out = Join-Path $snapDir ("VaultBook-QB-snapshot-$safe-" + (Get-Date).ToString('yyyy-MM-dd-HHmm') + $stamp + '.json')
  [IO.File]::WriteAllText($out, (ToJson $snap), (New-Object System.Text.UTF8Encoding $false))
  Write-Host ''
  Box @("Transactions  $($txns.Count)", "Period        $From to $To", '', 'Saved to:', $out) 'White' 'DarkGreen' 'SNAPSHOT SAVED'
  $out
}

# ---- Export everything: QuickBooks' own answers as JSON (VaultBook converts them; see js/qbfull.js) ----
function XObj($n) {
  $h = @{}
  foreach ($c in $n.ChildNodes) {
    if ($c.NodeType -ne 'Element') { continue }
    $hasEl = $false; foreach ($g in $c.ChildNodes) { if ($g.NodeType -eq 'Element') { $hasEl = $true; break } }
    $v = if ($hasEl) { XObj $c } else { $c.InnerText }
    $k = $c.LocalName
    if ($h.ContainsKey($k)) {
      if (-not ($h[$k] -is [System.Collections.ArrayList])) { $l = New-Object System.Collections.ArrayList; [void]$l.Add($h[$k]); $h[$k] = $l }
      [void]$h[$k].Add($v)
    } else { $h[$k] = $v }
  }
  $h
}
# fast JSON for big exports (StringBuilder; hashtables, lists and text only)
function JW([System.Text.StringBuilder]$sb, $v) {
  if ($null -eq $v) { [void]$sb.Append('null'); return }
  if ($v -is [string]) { [void]$sb.Append((JStr $v)); return }
  if ($v -is [int] -or $v -is [int64]) { [void]$sb.Append([string]$v); return }
  if ($v -is [System.Collections.IDictionary]) { [void]$sb.Append('{'); $first = $true; foreach ($k in $v.Keys) { if (-not $first) { [void]$sb.Append(',') }; $first = $false; [void]$sb.Append((JStr "$k")); [void]$sb.Append(':'); JW $sb $v[$k] }; [void]$sb.Append('}'); return }
  if ($v -is [System.Collections.IEnumerable]) { [void]$sb.Append('['); $first = $true; foreach ($x in $v) { if (-not $first) { [void]$sb.Append(',') }; $first = $false; JW $sb $x }; [void]$sb.Append(']'); return }
  [void]$sb.Append((JStr ([string]$v)))
}
function QueryAll([string]$rq, [string]$inner) {
  $out = New-Object System.Collections.ArrayList
  $rs = $null; try { $rs = (Send "<$rq>$inner</$rq>").ChildNodes | Select-Object -First 1 } catch { }
  if (-not $rs -or -not (Ok $rs)) { return ,$out }
  foreach ($r in $rs.ChildNodes) { if ($r.NodeType -eq 'Element') { $o = XObj $r; $o['_type'] = $r.LocalName; [void]$out.Add($o) } }
  return ,$out
}
function DoExport() {
  $lists = [ordered]@{}; $txns = [ordered]@{}
  Section 'LISTS'
  foreach ($L in @(@('Account', '<ActiveStatus>All</ActiveStatus>'), @('Customer', '<ActiveStatus>All</ActiveStatus>'), @('Vendor', '<ActiveStatus>All</ActiveStatus>'), @('Employee', '<ActiveStatus>All</ActiveStatus>'),
                   @('OtherName', '<ActiveStatus>All</ActiveStatus>'), @('Item', '<ActiveStatus>All</ActiveStatus>'), @('Class', '<ActiveStatus>All</ActiveStatus>'),
                   @('StandardTerms', '<ActiveStatus>All</ActiveStatus>'), @('DateDrivenTerms', '<ActiveStatus>All</ActiveStatus>'))) {
    $lists[$L[0]] = QueryAll ($L[0] + 'QueryRq') $L[1]
    Done $L[0] ("{0,7}" -f $lists[$L[0]].Count) $(if ($lists[$L[0]].Count) { 'White' } else { 'DarkGray' })
  }
  Section 'TRANSACTIONS (year by year)'
  $types = @('Invoice', 'SalesReceipt', 'CreditMemo', 'ReceivePayment', 'ARRefundCreditCard', 'Bill', 'VendorCredit', 'BillPaymentCheck', 'BillPaymentCreditCard',
             'Check', 'CreditCardCharge', 'CreditCardCredit', 'Deposit', 'Transfer', 'JournalEntry', 'SalesTaxPaymentCheck')
  $total = 0
  foreach ($t in $types) {
    $all = New-Object System.Collections.ArrayList
    $lines = if ($t -eq 'Transfer') { '' } else { '<IncludeLineItems>true</IncludeLineItems>' }
    # first year with this type (dates only, small answer), then one query per year so big files stay manageable
    $first = $null
    $range = if ($From) { "<TxnDateRangeFilter><FromTxnDate>$From</FromTxnDate><ToTxnDate>$To</ToTxnDate></TxnDateRangeFilter>" } else { '' }
    $rs = $null; try { $rs = (Send "<${t}QueryRq>$range<IncludeRetElement>TxnDate</IncludeRetElement></${t}QueryRq>").ChildNodes | Select-Object -First 1 } catch { }
    if (-not $rs -or -not (Ok $rs)) { Done $t ('skipped: ' + $(if ($rs) { $rs.statusMessage } else { 'no answer' })) DarkYellow; $txns[$t] = $all; continue }
    foreach ($r in $rs.ChildNodes) { if ($r.TxnDate) { $d = "$($r.TxnDate)".Substring(0, 10); if (-not $first -or $d -lt $first) { $first = $d } } }
    if ($first) {
      $y0 = [int]$first.Substring(0, 4); $y1 = [int]$To.Substring(0, 4)
      for ($y = $y0; $y -le $y1; $y++) {
        $f = "$y-01-01"; if ($From -and $From -gt $f) { $f = $From }
        $e = "$y-12-31"; if ($To -lt $e) { $e = $To }
        $chunk = QueryAll "${t}QueryRq" "<TxnDateRangeFilter><FromTxnDate>$f</FromTxnDate><ToTxnDate>$e</ToTxnDate></TxnDateRangeFilter>$lines"
        foreach ($x in $chunk) { [void]$all.Add($x) }
        Progress $t ($y - $y0 + 1) ($y1 - $y0 + 1) ("{0,7}  {1}" -f $all.Count, $y)
      }
    }
    Done $t ("{0,7}" -f $all.Count) $(if ($all.Count) { 'White' } else { 'DarkGray' })
    $txns[$t] = $all; $total += $all.Count
  }
  $co = @{}; try { $c = (Send '<CompanyQueryRq/>').CompanyQueryRs; if ($c -and $c.CompanyRet) { $co = XObj $c.CompanyRet } } catch { }
  $doc = [ordered]@{ format = 'vaultbook-qb-full'; version = 1; at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); from = "$From"; to = $To; company = $co; lists = $lists; txns = $txns }
  $name = "$($co['CompanyName'])"; $safe = ($name -replace '[^\w\- ]+', '').Trim() -replace '\s+', '-'; if (-not $safe) { $safe = 'company' }
  $out = Join-Path $snapDir ("VaultBook-QB-full-$safe-" + (Get-Date).ToString('yyyy-MM-dd-HHmm') + '.json')
  Say 'Writing the file...' DarkGray
  $sb = New-Object System.Text.StringBuilder (1048576)
  JW $sb $doc
  [IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
  Write-Host ''
  Box @("Accounts      $($lists['Account'].Count)", "Customers     $($lists['Customer'].Count)", "Vendors       $($lists['Vendor'].Count)", "Items         $($lists['Item'].Count)", "Transactions  $total", '', 'Saved to:', $out) 'White' 'DarkGreen' 'EXPORT COMPLETE'
  $out
}

# ---- Reports and ledgers straight from QuickBooks (1.37): choose what, choose the dates, get a .csv that opens in Excel ----
# The figures are QuickBooks' own reports (General Ledger, Profit and Loss ...), so they agree with what QuickBooks shows.
$script:reportFiles = New-Object System.Collections.ArrayList
$REPORTS = @(
  @('1', 'Account ledger', 'One bank, card or any account: every entry, running balance', 'D', 'GeneralLedger'),
  @('2', 'General ledger', 'Every account with its entries', 'D', 'GeneralLedger'),
  @('3', 'Transaction list', 'Every transaction by date', 'D', 'TxnListByDate'),
  @('4', 'Profit and Loss', 'Income and expenses for the dates', 'S', 'ProfitAndLossStandard'),
  @('5', 'Balance Sheet', 'Assets, liabilities and equity at the end date', 'S', 'BalanceSheetStandard'),
  @('6', 'Trial Balance', 'Debit or credit balance of every account', 'S', 'TrialBalance'),
  @('7', 'Open invoices', 'Unpaid customer invoices as of today', 'D', 'OpenInvoices'),
  @('8', 'Unpaid bills', 'Unpaid vendor bills as of today', 'D', 'UnpaidBillsDetail'))
function Ymd([datetime]$d) { $d.ToString('yyyy-MM-dd', $inv) }
function ParseDay([string]$s) {
  $s = "$s".Trim(); if (-not $s) { return $null }
  $us = [Globalization.CultureInfo]::GetCultureInfo('en-US'); $d = [datetime]::MinValue
  foreach ($f in @('yyyy-MM-dd', 'M/d/yyyy', 'M/d/yy', 'M-d-yyyy', 'M-d-yy', 'MMM d yyyy', 'MMM d, yyyy')) { if ([datetime]::TryParseExact($s, $f, $us, [Globalization.DateTimeStyles]::None, [ref]$d)) { return $d } }
  return $null
}
function ParseMonth([string]$s) {
  # 2026-05, 05/2026, 5/26, May 2026; a bare month (5 or May) means that month of this year
  $s = "$s".Trim(); if (-not $s) { return $null }
  $us = [Globalization.CultureInfo]::GetCultureInfo('en-US'); $d = [datetime]::MinValue
  if ($s -match '^\d{1,2}$') { $m = [int]$s; if ($m -ge 1 -and $m -le 12) { return (New-Object datetime ((Get-Date).Year, $m, 1)) }; return $null }
  if ($s -match '^[A-Za-z]+$') { $s = $s + ' ' + (Get-Date).Year }
  foreach ($f in @('yyyy-M', 'yyyy/M', 'M/yyyy', 'M-yyyy', 'M/yy', 'MMM yyyy', 'MMMM yyyy', 'MMM yy')) { if ([datetime]::TryParseExact($s, $f, $us, [Globalization.DateTimeStyles]::None, [ref]$d)) { return (New-Object datetime ($d.Year, $d.Month, 1)) } }
  return $null
}
function PickPeriod() {
  # -> @{ from; to; label } (from/to yyyy-MM-dd, empty for all dates), or $null to go back
  $t = (Get-Date).Date; $m1 = New-Object datetime ($t.Year, $t.Month, 1); $q1 = New-Object datetime ($t.Year, ((([Math]::Floor(($t.Month - 1) / 3)) * 3) + 1), 1)
  $lm1 = $m1.AddMonths(-1); $y1 = New-Object datetime ($t.Year, 1, 1); $ly1 = $y1.AddYears(-1)
  $span = { param($a, $b) (Ymd $a) + ' to ' + (Ymd $b) }
  Write-Host ''
  $k = Menu @(
    @('1', 'This month', (& $span $m1 $m1.AddMonths(1).AddDays(-1))),
    @('2', 'Last month', (& $span $lm1 $m1.AddDays(-1))),
    @('3', 'Choose a month', 'You type it: 05/2026, 2026-05 or May 2026'),
    @('4', 'This quarter', (& $span $q1 $q1.AddMonths(3).AddDays(-1))),
    @('5', 'This year', (& $span $y1 $y1.AddYears(1).AddDays(-1))),
    @('6', 'Last year', (& $span $ly1 $y1.AddDays(-1))),
    @('7', 'Custom dates', 'You type the first and the last day'),
    @('8', 'All dates', 'Everything in the company file')) 'WHICH DATES'
  $a = $null; $b = $null
  switch ("$k") {
    '1' { $a = $m1; $b = $m1.AddMonths(1).AddDays(-1) }
    '2' { $a = $lm1; $b = $m1.AddDays(-1) }
    '3' { while (-not $a) { $x = Read-Host '  Month (for example 05/2026, 2026-05 or May 2026; Enter = back)'; if (-not "$x".Trim()) { return $null }; $a = ParseMonth $x; if (-not $a) { Say '  Not a month. Try 05/2026.' Yellow } }; $b = $a.AddMonths(1).AddDays(-1) }
    '4' { $a = $q1; $b = $q1.AddMonths(3).AddDays(-1) }
    '5' { $a = $y1; $b = $y1.AddYears(1).AddDays(-1) }
    '6' { $a = $ly1; $b = $y1.AddDays(-1) }
    '7' {
      while (-not $a) { $x = Read-Host '  From date (for example 05/01/2026 or 2026-05-01; Enter = back)'; if (-not "$x".Trim()) { return $null }; $a = ParseDay $x; if (-not $a) { Say '  Not a date. Try 05/01/2026.' Yellow } }
      while (-not $b) { $x = Read-Host '  To date   (for example 05/31/2026; Enter = back)'; if (-not "$x".Trim()) { return $null }; $b = ParseDay $x; if (-not $b) { Say '  Not a date. Try 05/31/2026.' Yellow } elseif ($b -lt $a) { Say '  The To date is before the From date.' Yellow; $b = $null } }
    }
    '8' { return @{ from = ''; to = ''; label = 'all dates' } }
    default { return $null }
  }
  return @{ from = (Ymd $a); to = (Ymd $b); label = ((Ymd $a) + ' to ' + (Ymd $b)) }
}
function PickAccount($accts) {
  # bank and card accounts first; typing part of a name or number searches every account
  $show = @($accts | Where-Object { $_.Type -eq 'Bank' -or $_.Type -eq 'CreditCard' }); $head = 'BANK AND CREDIT CARD ACCOUNTS'
  while ($true) {
    Write-Host ''; Section $head
    $n = [Math]::Min($show.Count, 40)
    if (-not $n) { Say '  No account matches.' Yellow }
    for ($i = 0; $i -lt $n; $i++) { Say ('  ' + (Pad ([string]($i + 1)) 4) + (Pad $show[$i].Name 48) + ' ' + $show[$i].Type) White }
    if ($show.Count -gt $n) { Say ('  ... and ' + ($show.Count - $n) + ' more. Type more letters to narrow the list.') DarkGray }
    $a = Read-Host '  Type a number from the list, or part of any account name or number to search (Enter = back)'
    $a = "$a".Trim(); if (-not $a) { return $null }
    $k = 0
    if ([int]::TryParse($a, [ref]$k) -and $k -ge 1 -and $k -le $n) { return $show[$k - 1] }
    $low = $a.ToLowerInvariant()
    $show = @($accts | Where-Object { $_.Name.ToLowerInvariant().Contains($low) -or $_.Number.Contains($a) })
    $head = 'ACCOUNTS MATCHING "' + $a + '"'
    if ($show.Count -eq 1) { Say ('  ' + $show[0].Name) Green; return $show[0] }
  }
}
function CsvLine($cells) { $o = New-Object System.Collections.ArrayList; foreach ($c in $cells) { [void]$o.Add('"' + ("$c".Replace('"', '""')) + '"') }; ($o -join ',') }
function RunReport($def, $acct, $per, [string]$dir) {
  # one QuickBooks report -> a .csv file; returns its path, or $null when QuickBooks refused the request
  $detail = $def[3] -eq 'D'; $tag = $(if ($detail) { 'GeneralDetailReport' } else { 'GeneralSummaryReport' })
  $period = ''
  if ($per) { if ($per.from) { $period = '<ReportPeriod><FromReportDate>' + $per.from + '</FromReportDate><ToReportDate>' + $per.to + '</ToReportDate></ReportPeriod>' } else { $period = '<ReportDateMacro>All</ReportDateMacro>' } }
  $filter = $(if ($acct) { '<ReportAccountFilter><ListID>' + (X $acct.ListID) + '</ListID></ReportAccountFilter>' } else { '' })
  $cols = ''
  if ($def[0] -eq '1' -or $def[0] -eq '2') { foreach ($c in @('TxnType', 'Date', 'RefNumber', 'Name', 'Memo', 'ClearedStatus', 'SplitAccount', 'Debit', 'Credit', 'RunningBalance')) { $cols += "<IncludeColumn>$c</IncludeColumn>" } }
  if ($def[0] -eq '3') { foreach ($c in @('TxnType', 'Date', 'RefNumber', 'Name', 'Memo', 'Account', 'ClearedStatus', 'SplitAccount', 'Debit', 'Credit')) { $cols += "<IncludeColumn>$c</IncludeColumn>" } }
  $head = '<' + $tag + 'QueryRq><' + $tag + 'Type>' + $def[4] + '</' + $tag + 'Type><DisplayReport>false</DisplayReport>' + $period + $filter
  # first with the columns we want; if this QuickBooks version refuses them, the report's own columns
  $tries = @(($head + $cols + '</' + $tag + 'QueryRq>'))
  if ($cols) { $tries += ($head + '</' + $tag + 'QueryRq>') }
  Say ''; Say ('  Asking QuickBooks for ' + $def[1] + $(if ($acct) { ' - ' + $acct.Name } else { '' }) + $(if ($per) { ' (' + $per.label + ')' } else { '' }) + '...') Cyan
  $ret = $null; $why = ''
  foreach ($rq in $tries) {
    try { $rs = (Send $rq).ChildNodes | Select-Object -First 1; if (Ok $rs) { $ret = $rs.ReportRet; if ($ret) { break } } else { $why = "$($rs.statusMessage)" } }
    catch { $why = $_.Exception.Message }
  }
  if (-not $ret) { Box @('QuickBooks did not return this report.', $why) 'White' 'DarkRed' 'PROBLEM'; return $null }

  $ncol = 0; [void][int]::TryParse("$($ret.NumColumns)", [ref]$ncol); if ($ncol -lt 1) { $ncol = 1 }
  $titles = New-Object string[] $ncol
  foreach ($cd in @($ret.ColDesc)) {
    if (-not $cd) { continue }
    $id = 0; [void][int]::TryParse("$($cd.colID)", [ref]$id); $t = ''
    foreach ($ct in @($cd.ColTitle)) { if ($ct -and $ct.value) { $t = ($t + ' ' + $ct.value).Trim() } }
    if ($id -ge 1 -and $id -le $ncol) { $titles[$id - 1] = $t }
  }
  if (-not $titles[0] -and $detail) { $titles[0] = 'Account' }
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add((CsvLine @("$($ret.ReportTitle)"))); $lines.Add((CsvLine @("$($ret.ReportSubtitle)")))
  $lines.Add((CsvLine @($(if ($acct) { $acct.Name } else { '' }), $(if ($per) { $per.label } else { 'as of ' + (Ymd (Get-Date)) }), "$($ret.ReportBasis)")))
  $lines.Add(''); $lines.Add((CsvLine $titles))
  $nData = 0; $total = $null
  if ($ret.ReportData) {
    foreach ($r in $ret.ReportData.ChildNodes) {
      if ($r.NodeType -ne 'Element') { continue }
      $cells = New-Object string[] $ncol
      if ($r.LocalName -eq 'TextRow') { $cells[0] = "$($r.value)" }
      else {
        foreach ($c in @($r.ColData)) { if ($c) { $id = 0; [void][int]::TryParse("$($c.colID)", [ref]$id); if ($id -ge 1 -and $id -le $ncol) { $cells[$id - 1] = "$($c.value)" } } }
        if (-not $cells[0] -and $r.RowData) { $cells[0] = "$($r.RowData.value)" }
        if ($r.LocalName -eq 'DataRow') { $nData++ } elseif ($r.LocalName -eq 'TotalRow' -or $r.LocalName -eq 'SubtotalRow') { $total = $cells }
      }
      $lines.Add((CsvLine $cells))
    }
  }
  $name = ($def[1] + $(if ($acct) { ' - ' + $acct.Name } else { '' }) + ' - ' + $(if ($per) { $per.label } else { 'as of ' + (Ymd (Get-Date)) })) -replace '[\\/:*?"<>|]+', '-'
  $out = Join-Path $dir ($name + '.csv')
  $enc = New-Object System.Text.UTF8Encoding $true   # with the mark Excel needs to read names correctly
  try { [IO.File]::WriteAllLines($out, $lines, $enc) }
  catch { $out = Join-Path $dir ($name + ' ' + (Get-Date).ToString('HHmmss') + '.csv'); [IO.File]::WriteAllLines($out, $lines, $enc) }   # the first name is open in Excel
  $sum = @(($def[1] + $(if ($acct) { ': ' + $acct.Name } else { '' })), ('Dates   ' + $(if ($per) { $per.label } else { 'as of today' })), ('Lines   ' + $nData))
  if ($total) { $tt = @(); for ($i = 0; $i -lt $ncol; $i++) { if ($total[$i]) { $tt += ($(if ($titles[$i] -and $i -gt 0) { $titles[$i] + ' ' } else { '' }) + $total[$i]) } }; if ($tt.Count) { $sum += ('Total   ' + ($tt -join '   ')) } }
  $sum += @('', 'Saved:', $out)
  Write-Host ''; Box $sum 'Black' 'Green' 'DONE'
  return $out
}
function DoReports() {
  $accts = New-Object System.Collections.ArrayList
  $rsA = (Send '<AccountQueryRq><ActiveStatus>All</ActiveStatus></AccountQueryRq>').AccountQueryRs
  if ($rsA) { foreach ($a in @($rsA.AccountRet)) { if ($a) { [void]$accts.Add([pscustomobject]@{ Name = "$($a.FullName)"; Type = "$($a.AccountType)"; Number = "$($a.AccountNumber)"; ListID = "$($a.ListID)" }) } } }
  $dir = $SnapshotTo
  while ($true) {
    Banner 'Reports and ledgers'
    $k = Menu $REPORTS 'WHAT TO EXPORT'
    if (-not $k) { break }
    $def = $null; foreach ($r in $REPORTS) { if ($r[0] -eq $k) { $def = $r } }
    $acct = $null; if ($k -eq '1') { $acct = PickAccount $accts; if (-not $acct) { continue } }
    $per = $null; if ($k -ne '7' -and $k -ne '8') { $per = PickPeriod; if (-not $per) { continue } }
    if (-not $dir) {
      $dir = PickFolder 'Choose the folder where the exported files should be saved'
      if (-not $dir) { Say 'No folder chosen. Nothing was exported.' Yellow; break }
      if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $dir = (Resolve-Path -LiteralPath $dir).Path; SaveDir (Join-Path $dir 'x')
    }
    $f = RunReport $def $acct $per $dir
    if ($Yes) { if ($f) { [void]$script:reportFiles.Add($f) }; break }
    if ($f) { [void]$script:reportFiles.Add($f); if (Ask 'Open the file now?') { try { Invoke-Item -LiteralPath $f } catch { } } }
    if (-not (Ask 'Export something else?')) { break }
  }
}

# ---- 1.63: remove from QuickBooks what VaultBook sent (entries carrying [VB:...] in the memo), for chosen dates ----
$script:removeFile = ''
function DoRemove() {
  Box @('Removes from QuickBooks ONLY the entries this tool recorded from VaultBook.',
        'They carry [VB:...] in the memo. Entries typed in QuickBooks are never touched.',
        'A removal cannot be undone: first choose File > Back Up Company in QuickBooks.') 'White' 'DarkRed' 'REMOVE WHAT VAULTBOOK SENT'
  $per = PickPeriod
  if (-not $per) { Say 'Nothing was removed.' Yellow; return }
  if (-not $per.from) { Say 'Choose dates (All dates is not allowed here). Nothing was removed.' Yellow; return }
  # deposits before customer payments, payments before invoices: QuickBooks refuses to delete what another entry still uses
  $types = @(@('Deposit', 'Deposit'), @('ReceivePayment', 'Customer payment'), @('Check', 'Check'), @('Transfer', 'Transfer'),
             @('CreditCardCharge', 'Card charge'), @('CreditCardCredit', 'Card credit'), @('JournalEntry', 'Journal entry'), @('Invoice', 'Invoice'))
  $found = @()
  Say "Looking in QuickBooks, $($per.label)..." Cyan
  foreach ($ty in $types) {
    $q = "$($ty[0])QueryRq"; $inc = $(if ($ty[0] -eq 'JournalEntry') { '<IncludeLineItems>true</IncludeLineItems>' } else { '' })
    $rs = $null; try { $rs = (Send "<$q><TxnDateRangeFilter><FromTxnDate>$($per.from)</FromTxnDate><ToTxnDate>$($per.to)</ToTxnDate></TxnDateRangeFilter>$inc</$q>").ChildNodes | Select-Object -First 1 } catch { }
    if (-not $rs -or -not (Ok $rs)) { continue }
    foreach ($t in @($rs.ChildNodes)) {
      if (-not $t -or -not $t.TxnID) { continue }
      $memo = "$($t.Memo)"
      if ($ty[0] -eq 'JournalEntry') { foreach ($l in (@($t.JournalDebitLine) + @($t.JournalCreditLine))) { if ($l -and "$($l.Memo)" -match '\[VB:') { $memo = "$($l.Memo)"; break } } }
      $m = [regex]::Match($memo, '\[VB:([^\]]+)\]'); if (-not $m.Success) { continue }
      $amt = ''; foreach ($f in @('Amount', 'DepositTotal', 'TotalAmount', 'Subtotal')) { if (-not $amt -and $t.$f) { $amt = "$($t.$f)" } }
      $found += [pscustomobject]@{ type = $ty[0]; kind = $ty[1]; txnId = "$($t.TxnID)"; date = "$($t.TxnDate)"; num = "$($t.RefNumber)"; key = $m.Groups[1].Value; amount = $amt }
    }
  }
  Section 'FOUND IN QUICKBOOKS'
  if (-not $found.Count) { Say "  Nothing from VaultBook in QuickBooks, $($per.label). Nothing was removed." Yellow; return }
  $lines = @()
  foreach ($g in ($found | Group-Object kind)) { $lines += ("{0,-18} {1,6}" -f $g.Name, $g.Count) }
  foreach ($x in @($found | Select-Object -First 12)) { Say ("  {0}  {1,-16} {2,-8} {3,12}" -f $x.date, $x.kind, $x.num, $x.amount) Gray }
  if ($found.Count -gt 12) { Say "  ... and $($found.Count - 12) more" DarkGray }
  Write-Host ''
  Box ($lines + @('', ("Total to remove     {0,6}" -f $found.Count), "Dates: $($per.label)")) 'White' 'DarkRed' 'TO REMOVE'
  Write-Host ''
  $typed = Read-Host "  Type DELETE (capital letters) to remove these $($found.Count) entries from QuickBooks, or press Enter to stop"
  if ("$typed" -cne 'DELETE') { Say '  Nothing was removed.' Yellow; return }
  Say ''
  $gone = 0; $stopped = ''
  foreach ($x in $found) {
    if ($stopped) { Note $x.key 'removed' "$($x.kind) $($x.date) $($x.num)" 'Ready' $x.txnId 'not removed (QuickBooks stopped before this one)'; continue }
    $rs = $null; try { $rs = (Send "<TxnDelRq><TxnDelType>$($x.type)</TxnDelType><TxnID>$($x.txnId)</TxnID></TxnDelRq>").TxnDelRs } catch { $stopped = $_.Exception.Message }
    $label = "$($x.kind) $($x.date) $($x.num) $($x.amount)"
    if ($stopped) { Write-Host '  ' -NoNewline; Write-Host ' STOPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $label" -ForegroundColor Red; Note $x.key 'removed' $label 'Problem' $x.txnId 'QuickBooks stopped: check in QuickBooks whether this one is gone'; continue }
    Start-Sleep -Milliseconds 300
    if ($rs -and $rs.statusCode -eq '0') { $gone++; Write-Host '  ' -NoNewline; Write-Host ' REMOVED  ' -ForegroundColor Black -BackgroundColor Yellow -NoNewline; Write-Host "  $label" -ForegroundColor Yellow; Note $x.key 'removed' $label 'Deleted' $x.txnId '' }
    else { $why = $(if ($rs) { "$($rs.statusMessage)" } else { 'no answer' }); Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  ${label}: $why" -ForegroundColor Red; Note $x.key 'removed' $label 'Problem' $x.txnId "QuickBooks said: $why" }
  }
  Write-Host ''
  Box @(("Removed        {0,6}" -f $gone), ("Not removed    {0,6}" -f ($found.Count - $gone))) 'White' $(if ($stopped -or $gone -lt $found.Count) { 'DarkRed' } else { 'DarkBlue' }) 'DONE'
  $dir = PickFolder 'Where should the removal record for VaultBook be saved?'
  if (-not $dir) { $dir = Join-Path $env:LOCALAPPDATA 'VaultBook'; New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $f = Join-Path $dir ('VaultBook-QB-removed-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.result.json')
  $res = [pscustomobject]@{ format = 'vaultbook-qb-result'; version = 3; company = ''; batch = 'remove'; at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); items = @($script:results.ToArray()) }
  [IO.File]::WriteAllText($f, (ToJson $res), (New-Object System.Text.UTF8Encoding $false))
  $script:removeFile = $f
}

$snapBefore = ''; $snapAfter = ''; $exportFile = ''
$ticket = $null; $fatal = $false
try {
  $rp.OpenConnection2('', $AppName, 1)
  $ticket = $rp.BeginSession('', 2)

  if ($doExport) { Say 'Exporting everything from QuickBooks (this can take a few minutes for a large file)...' Cyan; $exportFile = DoExport }
  if ($doReports) { $null = DoReports }
  if ($doRemove) { DoRemove }
  if ($doRead) { Say 'Reading QuickBooks...' Cyan; $snapBefore = DoRead ''; Say '' }
  if ($doSend) {
  # ---- lists from QuickBooks ----
    $accounts = @{}; $rs = (Send '<AccountQueryRq><ActiveStatus>All</ActiveStatus></AccountQueryRq>').AccountQueryRs
    foreach ($a in @($rs.AccountRet)) { if ($a) { $accounts[$a.FullName] = $a } }
    $customers = @{}; $rs = (Send '<CustomerQueryRq><ActiveStatus>All</ActiveStatus></CustomerQueryRq>').CustomerQueryRs
    foreach ($c in @($rs.CustomerRet)) { if ($c) { $customers[$c.FullName.ToLowerInvariant()] = $c } }
    $items = @{}; $rs = (Send '<ItemQueryRq><ActiveStatus>All</ActiveStatus></ItemQueryRq>').ItemQueryRs
    if ($rs) { foreach ($node in $rs.ChildNodes) { if ($node.FullName) { $items[$node.FullName.ToLowerInvariant()] = $node } } }
  
    # ---- what is missing? ----
    $needCust = @{}; $needItem = @{}
    function ItemFor($line) {
      # exact item name, else the longest item name the description starts with
      if ($line.item -and $items.ContainsKey($line.item.ToLowerInvariant())) { return $line.item }
      $d = "$($line.description)".ToLowerInvariant(); $best = ''
      if ($d) { foreach ($k in $items.Keys) { if ($d.StartsWith($k) -and $k.Length -gt $best.Length -and ($d.Length -eq $k.Length -or -not [char]::IsLetterOrDigit($d[$k.Length]))) { $best = $k } } }
      if ($best) { return $items[$best].FullName }
      return $null
    }
    foreach ($i in $invoices) {
      if (-not $customers.ContainsKey($i.customer.ToLowerInvariant())) { $needCust[$i.customer] = $i }
      foreach ($l in @($i.lines)) {
        if (-not (ItemFor $l)) { $n = if ($l.item) { $l.item } else { "$($l.description)".Trim() }; if ($n -and -not $needItem.ContainsKey($n)) { $needItem[$n] = $l } }
      }
    }
    foreach ($p in $payments) { if (-not $customers.ContainsKey($p.customer.ToLowerInvariant())) { $needCust[$p.customer] = $p } }
  
    # ---- bank transactions (1.38): accounts and names they need (ask once for each list) ----
    $allNames = @{}; foreach ($k in $customers.Keys) { $allNames[$k] = 'customer' }
    if ($bank.Count -or $updates.Count) {
      foreach ($L in @('Vendor', 'Employee', 'OtherName')) {
        $rsN = $null; try { $rsN = (Send "<${L}QueryRq><ActiveStatus>All</ActiveStatus></${L}QueryRq>").ChildNodes | Select-Object -First 1 } catch { }
        if ($rsN) { foreach ($n in $rsN.ChildNodes) { if ($n.Name) { $allNames["$($n.Name)".ToLowerInvariant()] = $L } } }
      }
      $needAcc = New-Object System.Collections.ArrayList; $needName = New-Object System.Collections.ArrayList
      $wantAcc = { param($a) if ($a -and -not $accounts.ContainsKey("$a") -and -not $needAcc.Contains("$a")) { [void]$needAcc.Add("$a") } }
      $wantName = { param($n) if ($n -and -not $allNames.ContainsKey("$n".ToLowerInvariant()) -and -not $needName.Contains("$n")) { [void]$needName.Add("$n") } }
      foreach ($u in $updates) {
        if ($u.header) { & $wantName $u.header.payee }
        foreach ($l in @($u.lines)) { if ($l) { & $wantAcc $l.account; & $wantName $l.name } }
      }
      foreach ($x in $bank) {
        foreach ($a in @($x.account, $x.from, $x.to)) { & $wantAcc $a }
        & $wantName $x.payee
        foreach ($l in @($x.lines)) { if ($l) { & $wantAcc $l.account; & $wantName $l.name } }
      }
      if ($needAcc.Count) {
        Section 'ACCOUNTS NOT IN QUICKBOOKS'
        foreach ($a in $needAcc) { Say ("  " + $a + "   (" + "$($data.accounts.PSObject.Properties[$a].Value)" + ")") White }
        if (Ask "Create these $($needAcc.Count) account(s) in QuickBooks?") {
          foreach ($a in $needAcc) {
            $type = "$($data.accounts.PSObject.Properties[$a].Value)"; if (-not $type) { $type = 'Expense' }
            if ($CheckOnly) { Say "  (check only) would create account '$a'" Yellow; $accounts[$a] = @{ FullName = $a }; continue }
            $parts = $a.Split(':'); $path = ''
            for ($pi = 0; $pi -lt $parts.Count; $pi++) {
              $parent = $path; $path = $(if ($path) { $path + ':' + $parts[$pi] } else { $parts[$pi] })
              if ($accounts.ContainsKey($path)) { continue }
              $par = $(if ($parent) { "<ParentRef><FullName>$(X $parent)</FullName></ParentRef>" } else { '' })
              $rsA = (Send "<AccountAddRq><AccountAdd><Name>$(X $parts[$pi])</Name>$par<AccountType>$type</AccountType></AccountAdd></AccountAddRq>").AccountAddRs
              if (Ok $rsA) { $accounts[$path] = $rsA.AccountRet; Say "  created account '$path'" Green } else { Say "  could not create account '$path': $($rsA.statusMessage)" Red; break }
            }
          }
        }
      }
      if ($needName.Count) {
        Section 'NAMES NOT IN QUICKBOOKS'
        foreach ($n in $needName) { Say ("  " + $n + "   (" + "$($data.names.PSObject.Properties[$n].Value)" + ")") White }
        if (Ask "Create these $($needName.Count) name(s) in QuickBooks (vendors and customers as shown)?") {
          foreach ($n in $needName) {
            $kindN = "$($data.names.PSObject.Properties[$n].Value)"; $tagN = $(if ($kindN -eq 'customer') { 'Customer' } else { 'Vendor' })
            if ($CheckOnly) { Say "  (check only) would create $($tagN.ToLower()) '$n'" Yellow; $allNames[$n.ToLowerInvariant()] = $tagN; continue }
            $rsV = (Send "<${tagN}AddRq><${tagN}Add><Name>$(X $n)</Name></${tagN}Add></${tagN}AddRq>").ChildNodes | Select-Object -First 1
            if (Ok $rsV) { $allNames[$n.ToLowerInvariant()] = $tagN; if ($tagN -eq 'Customer') { $customers[$n.ToLowerInvariant()] = @{ FullName = $n } }; Say "  created $($tagN.ToLower()) '$n'" Green } else { Say "  could not create '$n': $($rsV.statusMessage)" Red }
          }
        }
      }
    }

    # ---- create missing customers / items (ask first) ----
    foreach ($name in @($needCust.Keys)) {
      if (Ask "Customer '$name' is not in QuickBooks. Create it?") {
        if ($CheckOnly) { Say "  (check only) would create customer '$name'" Yellow; $customers[$name.ToLowerInvariant()] = @{ FullName = $name }; continue }
        $src = $needCust[$name]; $addr = ''
        if ($src.billTo) { $k = 1; foreach ($ln in @($src.billTo)) { if ($k -le 5 -and $ln) { $addr += "<Addr$k>$(X ("$ln".Substring(0, [math]::Min(41, "$ln".Length))))</Addr$k>"; $k++ } } }
        $rs = (Send "<CustomerAddRq><CustomerAdd><Name>$(X $name)</Name>$(if ($addr) { "<BillAddress>$addr</BillAddress>" })</CustomerAdd></CustomerAddRq>").CustomerAddRs
        if (Ok $rs) { $customers[$name.ToLowerInvariant()] = $rs.CustomerRet; Say "  created customer '$name'" Green } else { Say "  could not create customer '$name': $($rs.statusMessage)" Red }
      }
    }
    foreach ($name in @($needItem.Keys)) {
      $l = $needItem[$name]; $acct = "$($l.incomeAccount)"
      if (-not $accounts.ContainsKey($acct)) {
        $cand = @($accounts.Values | Where-Object { $_.AccountType -eq 'Income' -and $_.FullName.ToLowerInvariant().EndsWith($acct.ToLowerInvariant()) })
        if ($cand.Count -eq 1) { $acct = $cand[0].FullName }
      }
      $q = "Item '$name' is not in QuickBooks. Create it as a Service item posting to '$acct'?"
      if (-not $accounts.ContainsKey($acct)) { $q = "Item '$name' is not in QuickBooks and its income account '$acct' was not found. Create the item anyway (QuickBooks will ask for the account)?" }
      if (Ask $q) {
        if ($CheckOnly) { Say "  (check only) would create item '$name'" Yellow; $items[$name.ToLowerInvariant()] = @{ FullName = $name }; continue }
        $acc = if ($accounts.ContainsKey($acct)) { "<AccountRef><FullName>$(X $acct)</FullName></AccountRef>" } else { '' }
        $rs = (Send "<ItemServiceAddRq><ItemServiceAdd><Name>$(X ($name.Substring(0, [math]::Min(31, $name.Length))))</Name><SalesOrPurchase><Desc>$(X $name)</Desc>$acc</SalesOrPurchase></ItemServiceAdd></ItemServiceAddRq>").ItemServiceAddRs
        if (Ok $rs) { $items[$rs.ItemServiceRet.FullName.ToLowerInvariant()] = $rs.ItemServiceRet; $items[$name.ToLowerInvariant()] = $rs.ItemServiceRet; Say "  created item '$($rs.ItemServiceRet.FullName)'" Green } else { Say "  could not create item '$name': $($rs.statusMessage)" Red }
      }
    }
    Say ''
  
    # ---- check invoices ----
    $plan = @()
    foreach ($i in $invoices) {
      $label = "Invoice $($i.number) $($i.customer) $($i.total)"; $msgs = @(); $status = 'Ready'; $txn = ''
      if (-not $customers.ContainsKey($i.customer.ToLowerInvariant())) { $status = 'Problem'; $msgs += "customer '$($i.customer)' not in QuickBooks" }
      if ("$($i.number)".Length -gt 11) { $status = 'Problem'; $msgs += "invoice number '$($i.number)' is longer than 11 characters (QuickBooks limit)" }
      $rs = (Send "<InvoiceQueryRq><RefNumber>$(X $i.number)</RefNumber></InvoiceQueryRq>").InvoiceQueryRs
      $dup = @($rs.InvoiceRet) | Where-Object { $_ -and $_.CustomerRef.FullName -eq $i.customer } | Select-Object -First 1
      if ($dup) { $status = 'Already in QuickBooks'; $txn = $dup.TxnID; $msgs += "found as TxnID $txn, total $($dup.Subtotal)" }
      $lines = ''; $sum = [int64]0
      foreach ($l in @($i.lines)) {
        $it = ItemFor $l
        if (-not $it) { if ($status -eq 'Ready') { $status = 'Problem' }; $msgs += "no item for line '$($l.description)'"; continue }
        if ($it -ne $l.item) { $msgs += "line '$($l.description)' -> item '$it'" }
        $sum += Cents $l.amount
        $qty = if ($l.qty) { "<Quantity>$($l.qty)</Quantity><Rate>$($l.rate)</Rate>" } else { "<Amount>$($l.amount)</Amount>" }
        $lines += "<InvoiceLineAdd><ItemRef><FullName>$(X $it)</FullName></ItemRef><Desc>$(X $l.description)</Desc>$qty</InvoiceLineAdd>"
      }
      $want = (Cents $i.total) - $(if ($i.tax) { Cents $i.tax } else { 0 })
      if ($sum -ne $want) { if ($status -eq 'Ready') { $status = 'Problem' }; $msgs += "lines add to $(Money $sum), invoice total (before tax) is $(Money $want)" }
      if ($i.tax) { $msgs += "sales tax $($i.tax) is not sent: set the tax code/item in QuickBooks" }
      $plan += [pscustomobject]@{ i = $i; label = $label; status = $status; txn = $txn; msgs = $msgs; lines = $lines }
    }
    # ---- check payments ----
    $depCache = @{}; $depUsed = @{}
    foreach ($p in $payments) {
      $label = "Payment $($p.date) $($p.customer) $($p.amount)"; $msgs = @(); $status = 'Ready'; $txn = ''; $apps = @()
      if (-not $customers.ContainsKey($p.customer.ToLowerInvariant())) { $status = 'Problem'; $msgs += "customer '$($p.customer)' not in QuickBooks" }
      if (-not $accounts.ContainsKey("$($p.depositTo)")) { $status = 'Problem'; $msgs += "no account named '$($p.depositTo)' in QuickBooks" }
      $total = Cents $p.amount
      $rs = (Send "<ReceivePaymentQueryRq><TxnDateRangeFilter><FromTxnDate>$($p.date)</FromTxnDate><ToTxnDate>$($p.date)</ToTxnDate></TxnDateRangeFilter><EntityFilter><FullName>$(X $p.customer)</FullName></EntityFilter></ReceivePaymentQueryRq>").ReceivePaymentQueryRs
      $dup = @($rs.ReceivePaymentRet) | Where-Object { $_ -and (Cents $_.TotalAmount) -eq $total -and (-not $p.ref -or "$($_.RefNumber)" -eq "$($p.ref)") } | Select-Object -First 1
      if ($dup) { $status = 'Already in QuickBooks'; $txn = $dup.TxnID }
      if (-not $dup) {
        # the same money may be in QuickBooks as a bank Deposit (posted to Accounts Receivable, not applied to an invoice)
        if (-not $depCache.ContainsKey("$($p.date)")) {
          $dr = $null; try { $dr = (Send "<DepositQueryRq><TxnDateRangeFilter><FromTxnDate>$($p.date)</FromTxnDate><ToTxnDate>$($p.date)</ToTxnDate></TxnDateRangeFilter><IncludeLineItems>true</IncludeLineItems></DepositQueryRq>").DepositQueryRs } catch { }
          $depCache["$($p.date)"] = @($(if ($dr) { $dr.DepositRet }) | Where-Object { $_ })
        }
        foreach ($d in $depCache["$($p.date)"]) {
          if ($depUsed.ContainsKey("$($d.TxnID)") -or "$($d.DepositToAccountRef.FullName)" -ne "$($p.depositTo)") { continue }
          $hit = (Cents $d.DepositTotal) -eq $total
          if (-not $hit) { foreach ($ln in @($d.DepositLineRet)) { if ($ln -and (Cents $ln.Amount) -eq $total) { $hit = $true } } }
          if ($hit) { $dup = $d; $depUsed["$($d.TxnID)"] = $true; $status = 'Already in QuickBooks'; $txn = $d.TxnID; $msgs += "in QuickBooks as a Deposit of the same date and amount into $($p.depositTo) (not applied to an invoice there)"; break }
        }
      }
      if (-not $dup) {
        foreach ($a in @($p.apply)) {
          $sentInv = $plan | Where-Object { $_.i.number -eq $a.invoice -and $_.i.customer -eq $p.customer } | Select-Object -First 1
          if ($sentInv -and $sentInv.status -eq 'Ready') { $msgs += "invoice $($a.invoice): sent in this run, apply $($a.amount)"; $apps += [pscustomobject]@{ inv = $a.invoice; amount = $a.amount; txn = '' }; continue }
          $rs = (Send "<InvoiceQueryRq><RefNumber>$(X $a.invoice)</RefNumber></InvoiceQueryRq>").InvoiceQueryRs
          $qi = @($rs.InvoiceRet) | Where-Object { $_ -and $_.CustomerRef.FullName -eq $p.customer } | Select-Object -First 1
          if (-not $qi) { $status = 'Problem'; $msgs += "invoice $($a.invoice) for $($p.customer) not found"; continue }
          $open = Cents $qi.BalanceRemaining; $w = Cents $a.amount
          if ($w -gt $open) { $status = 'Problem'; $msgs += "invoice $($a.invoice) has only $(Money $open) open, payment applies $(Money $w)"; continue }
          $msgs += "invoice $($a.invoice): open $(Money $open), apply $(Money $w)"
          $apps += [pscustomobject]@{ inv = $a.invoice; amount = $a.amount; txn = $qi.TxnID }
        }
      }
      $plan += [pscustomobject]@{ p = $p; label = $label; status = $status; txn = $txn; msgs = $msgs; apps = $apps }
    }
  
    # ---- check bank transactions (1.38) ----
    $bq = @{ check = @('CheckQueryRq', 'Amount'); cardCharge = @('CreditCardChargeQueryRq', 'Amount'); cardCredit = @('CreditCardCreditQueryRq', 'Amount'); transfer = @('TransferQueryRq', 'Amount'); journal = @('JournalEntryQueryRq', '') }
    $bCache = @{}; $bUsed = @{}
    $ref = { param($n) "<FullName>$(X $n)</FullName>" }
    foreach ($x in $bank) {
      $kindLabel = @{ check = 'Check'; cardCharge = 'Card charge'; cardCredit = 'Card credit'; deposit = 'Deposit'; transfer = 'Transfer'; journal = 'Journal' }["$($x.kind)"]
      $where = $(if ($x.kind -eq 'transfer') { "$($x.from) -> $($x.to)" } elseif ($x.kind -eq 'journal') { "$($x.ref)" } else { "$($x.account) $($x.payee)" })
      $label = "$kindLabel $($x.date) $where $($x.amount)"; $msgs = @(); $status = 'Ready'; $txn = ''; $total = Cents $x.amount
      if (-not $kindLabel) { $plan += [pscustomobject]@{ b = $x; label = $label; status = 'Problem'; txn = ''; msgs = @("kind '$($x.kind)' is not known to this script"); xml = '' }; continue }
      foreach ($a in @($x.account, $x.from, $x.to)) { if ($a -and -not $accounts.ContainsKey("$a")) { $status = 'Problem'; $msgs += "no account named '$a' in QuickBooks" } }
      if ($x.payee -and -not $allNames.ContainsKey("$($x.payee)".ToLowerInvariant())) { $status = 'Problem'; $msgs += "name '$($x.payee)' not in QuickBooks" }
      $sum = [int64]0
      foreach ($l in @($x.lines)) {
        if (-not $l) { continue }
        if (-not $accounts.ContainsKey("$($l.account)")) { $status = 'Problem'; $msgs += "no account named '$($l.account)' in QuickBooks" }
        if ($l.name -and -not $allNames.ContainsKey("$($l.name)".ToLowerInvariant())) { $status = 'Problem'; $msgs += "name '$($l.name)' not in QuickBooks" }
        if ($x.kind -eq 'journal') { $sum += (Cents $l.debit) - (Cents $l.credit) } else { $sum += Cents $l.amount }
      }
      if ($x.kind -eq 'journal') { if ($sum -ne 0) { $status = 'Problem'; $msgs += 'debits and credits are not equal' } }
      elseif ($x.kind -ne 'transfer' -and $sum -ne $total) { $status = 'Problem'; $msgs += "lines add to $(Money $sum), the bank amount is $(Money $total)" }
      # already in QuickBooks? the same kind on the same date for the same amount and account (or carrying this entry's mark)
      $dup = $null
      if ($x.kind -eq 'deposit') {
        if (-not $depCache.ContainsKey("$($x.date)")) {
          $dr = $null; try { $dr = (Send "<DepositQueryRq><TxnDateRangeFilter><FromTxnDate>$($x.date)</FromTxnDate><ToTxnDate>$($x.date)</ToTxnDate></TxnDateRangeFilter><IncludeLineItems>true</IncludeLineItems></DepositQueryRq>").DepositQueryRs } catch { }
          $depCache["$($x.date)"] = @($(if ($dr) { $dr.DepositRet }) | Where-Object { $_ })
        }
        foreach ($d in $depCache["$($x.date)"]) { if (-not $depUsed.ContainsKey("$($d.TxnID)") -and (("$($d.Memo)" -like "*[[]VB:$($x.key)]*") -or ("$($d.DepositToAccountRef.FullName)" -eq "$($x.account)" -and (Cents $d.DepositTotal) -eq $total))) { $dup = $d; $depUsed["$($d.TxnID)"] = $true; break } }
      } else {
        $ck = "$($x.kind)|$($x.date)"
        if (-not $bCache.ContainsKey($ck)) {
          $q = $bq["$($x.kind)"]; $inc = $(if ($x.kind -eq 'journal') { '<IncludeLineItems>true</IncludeLineItems>' } else { '' }); $rsQ = $null
          try { $rsQ = (Send "<$($q[0])><TxnDateRangeFilter><FromTxnDate>$($x.date)</FromTxnDate><ToTxnDate>$($x.date)</ToTxnDate></TxnDateRangeFilter>$inc</$($q[0])>").ChildNodes | Select-Object -First 1 } catch { }
          $bCache[$ck] = @($(if ($rsQ -and (Ok $rsQ)) { $rsQ.ChildNodes }) | Where-Object { $_ -and $_.TxnID })
        }
        foreach ($d in $bCache[$ck]) {
          if ($bUsed.ContainsKey("$($d.TxnID)")) { continue }
          $amtD = $(if ($x.kind -eq 'journal') { Cents (JournalAmount $d) } else { Cents $d.Amount })
          $same = $amtD -eq $total
          if ($same -and ($x.kind -eq 'check' -or $x.kind -eq 'cardCharge' -or $x.kind -eq 'cardCredit')) { $same = "$($d.AccountRef.FullName)" -eq "$($x.account)" }
          if ($same -and $x.kind -eq 'transfer') { $same = "$($d.TransferFromAccountRef.FullName)" -eq "$($x.from)" -and "$($d.TransferToAccountRef.FullName)" -eq "$($x.to)" }
          if ($same -and $x.kind -eq 'journal' -and $x.ref) { $same = "$($d.RefNumber)" -eq "$($x.ref)" }
          if ($same -or ("$($d.Memo)" -like "*[[]VB:$($x.key)]*")) { $dup = $d; $bUsed["$($d.TxnID)"] = $true; break }
        }
      }
      if ($dup) { $plan += [pscustomobject]@{ b = $x; label = $label; status = 'Already in QuickBooks'; txn = "$($dup.TxnID)"; msgs = @("found in QuickBooks on the same date for the same amount (TxnID $($dup.TxnID))"); xml = '' }; continue }
      # ---- the request ----
      $memo = "<Memo>$(X (Mark $x.memo $x.key))</Memo>"; $xml = ''
      # 1.63: a check with no number is sent with an empty number; left out, QuickBooks gave it the next check number (9001, 9002 ...)
      $refNo = $(if ($x.ref) { "<RefNumber>$(X $x.ref)</RefNumber>" } elseif ($x.kind -eq 'check') { '<RefNumber></RefNumber>' } else { '' })
      $payee = $(if ($x.payee) { "<PayeeEntityRef>$(& $ref $x.payee)</PayeeEntityRef>" } else { '' })
      if ($x.kind -eq 'check' -or $x.kind -eq 'cardCharge' -or $x.kind -eq 'cardCredit') {
        $lx = ''
        foreach ($l in @($x.lines)) { if ($l) { $lx += "<ExpenseLineAdd><AccountRef>$(& $ref $l.account)</AccountRef><Amount>$($l.amount)</Amount>$(if ($l.memo) { "<Memo>$(X $l.memo)</Memo>" })</ExpenseLineAdd>" } }
        if ($x.kind -eq 'check') { $xml = "<CheckAddRq><CheckAdd><AccountRef>$(& $ref $x.account)</AccountRef>$payee$refNo<TxnDate>$($x.date)</TxnDate>$memo<IsToBePrinted>false</IsToBePrinted>$lx</CheckAdd></CheckAddRq>" }
        else { $tagC = $(if ($x.kind -eq 'cardCharge') { 'CreditCardCharge' } else { 'CreditCardCredit' }); $xml = "<${tagC}AddRq><${tagC}Add><AccountRef>$(& $ref $x.account)</AccountRef>$payee<TxnDate>$($x.date)</TxnDate>$refNo$memo$lx</${tagC}Add></${tagC}AddRq>" }
      }
      elseif ($x.kind -eq 'deposit') {
        $lx = ''
        foreach ($l in @($x.lines)) { if ($l) { $lx += "<DepositLineAdd>$(if ($l.name) { "<EntityRef>$(& $ref $l.name)</EntityRef>" })<AccountRef>$(& $ref $l.account)</AccountRef>$(if ($l.memo) { "<Memo>$(X $l.memo)</Memo>" })<Amount>$($l.amount)</Amount></DepositLineAdd>" } }
        $xml = "<DepositAddRq><DepositAdd><TxnDate>$($x.date)</TxnDate><DepositToAccountRef>$(& $ref $x.account)</DepositToAccountRef>$memo$lx</DepositAdd></DepositAddRq>"
      }
      elseif ($x.kind -eq 'transfer') { $xml = "<TransferAddRq><TransferAdd><TxnDate>$($x.date)</TxnDate><TransferFromAccountRef>$(& $ref $x.from)</TransferFromAccountRef><TransferToAccountRef>$(& $ref $x.to)</TransferToAccountRef><Amount>$($x.amount)</Amount>$memo</TransferAdd></TransferAddRq>" }
      else {
        $lx = ''; $first = $true
        foreach ($l in @($x.lines)) {
          if (-not $l) { continue }
          $tagJ = $(if ($l.debit) { 'JournalDebitLine' } else { 'JournalCreditLine' }); $amtJ = $(if ($l.debit) { $l.debit } else { $l.credit })
          $mJ = $(if ($first) { Mark $(if ($l.memo) { $l.memo } else { $x.memo }) $x.key } else { "$($l.memo)" }); $first = $false
          $lx += "<$tagJ><AccountRef>$(& $ref $l.account)</AccountRef><Amount>$amtJ</Amount>$(if ($mJ) { "<Memo>$(X $mJ)</Memo>" })$(if ($l.name) { "<EntityRef>$(& $ref $l.name)</EntityRef>" })</$tagJ>"
        }
        $xml = "<JournalEntryAddRq><JournalEntryAdd><TxnDate>$($x.date)</TxnDate>$refNo$lx</JournalEntryAdd></JournalEntryAddRq>"
      }
      $plan += [pscustomobject]@{ b = $x; label = $label; status = $status; txn = $txn; msgs = $msgs; xml = $xml }
    }

    # ---- edits and voids worked out by VaultBook (1.47): only what changed; QuickBooks checks EditSequence ----
    foreach ($u in $updates) {
      $kindLabel = @{ check = 'Check'; deposit = 'Deposit'; journal = 'Journal' }["$($u.kind)"]
      $label = "Edit $kindLabel $($u.label)"; $msgs = @($u.what); $status = 'Ready'
      if (-not $kindLabel) { $plan += [pscustomobject]@{ u = $u; label = $label; status = 'Problem'; txn = "$($u.txnId)"; msgs = @("kind '$($u.kind)' is not known to this script"); xml = '' }; continue }
      foreach ($l in @($u.lines)) { if ($l -and $l.account -and -not $accounts.ContainsKey("$($l.account)")) { $status = 'Problem'; $msgs += "no account named '$($l.account)' in QuickBooks" } }
      $hd = $u.header; $hx = ''
      $lx = ''
      foreach ($l in @($u.lines)) {
        if (-not $l) { continue }
        $acc = $(if ($l.account) { "<AccountRef>$(& $ref $l.account)</AccountRef>" } else { '' })
        $amt = $(if ($l.amount) { "<Amount>$($l.amount)</Amount>" } else { '' })
        $mem = $(if ($null -ne $l.memo) { "<Memo>$(X $l.memo)</Memo>" } else { '' })
        $ent = $(if ($l.name) { "<EntityRef>$(& $ref $l.name)</EntityRef>" } else { '' })
        if ($u.kind -eq 'check') { $lx += "<ExpenseLineMod><TxnLineID>$($l.lineId)</TxnLineID>$acc$amt$mem</ExpenseLineMod>" }
        elseif ($u.kind -eq 'deposit') { $lx += "<DepositLineMod><TxnLineID>$($l.lineId)</TxnLineID>$ent$acc$mem$amt</DepositLineMod>" }
        else { $lx += "<JournalLineMod><TxnLineID>$($l.lineId)</TxnLineID>$(if ($l.side) { "<JournalLineType>$($l.side)</JournalLineType>" })$acc$amt$mem$ent</JournalLineMod>" }
      }
      $head = "<TxnID>$($u.txnId)</TxnID><EditSequence>$($u.editSeq)</EditSequence>"
      if ($u.kind -eq 'check') {
        if ($hd -and $hd.payee) { $hx += "<PayeeEntityRef>$(& $ref $hd.payee)</PayeeEntityRef>" }
        if ($hd -and $null -ne $hd.ref) { $hx += "<RefNumber>$(X $hd.ref)</RefNumber>" }
        if ($hd -and $hd.date) { $hx += "<TxnDate>$($hd.date)</TxnDate>" }
        if ($hd -and $null -ne $hd.memo) { $hx += "<Memo>$(X $hd.memo)</Memo>" }
        $xml = "<CheckModRq><CheckMod>$head$hx$lx</CheckMod></CheckModRq>"
      } elseif ($u.kind -eq 'deposit') {
        if ($hd -and $hd.date) { $hx += "<TxnDate>$($hd.date)</TxnDate>" }
        if ($hd -and $null -ne $hd.memo) { $hx += "<Memo>$(X $hd.memo)</Memo>" }
        $xml = "<DepositModRq><DepositMod>$head$hx$lx</DepositMod></DepositModRq>"
      } else {
        if ($hd -and $hd.date) { $hx += "<TxnDate>$($hd.date)</TxnDate>" }
        if ($hd -and $null -ne $hd.ref) { $hx += "<RefNumber>$(X $hd.ref)</RefNumber>" }
        $xml = "<JournalEntryModRq><JournalEntryMod>$head$hx$lx</JournalEntryMod></JournalEntryModRq>"
      }
      $plan += [pscustomobject]@{ u = $u; label = $label; status = $status; txn = "$($u.txnId)"; msgs = $msgs; xml = $xml }
    }
    foreach ($v in $voids) {
      $tv = @{ check = 'Check'; deposit = 'Deposit'; journal = 'JournalEntry' }["$($v.kind)"]
      $plan += [pscustomobject]@{ v = $v; label = "Void $($v.label)"; status = $(if ($tv) { 'Ready' } else { 'Problem' }); txn = "$($v.txnId)"; msgs = @('voided in VaultBook'); xml = "<TxnVoidRq><TxnVoidType>$tv</TxnVoidType><TxnID>$($v.txnId)</TxnID></TxnVoidRq>" }
    }

    # ---- show the plan ----
    Section 'THE PLAN'
    foreach ($x in $plan) {
      $bg = switch ($x.status) { 'Ready' { 'DarkGreen' } 'Problem' { 'DarkRed' } default { 'DarkYellow' } }
      Write-Host '  ' -NoNewline; Write-Host (' ' + (Pad $x.status 21) + ' ') -ForegroundColor White -BackgroundColor $bg -NoNewline; Write-Host ('  ' + $x.label) -ForegroundColor White
      foreach ($m in $x.msgs) { Say ("      " + $B.Dot + " $m") DarkGray }
    }
    $ready = @($plan | Where-Object status -eq 'Ready'); $probs = @($plan | Where-Object status -eq 'Problem'); $dups = @($plan | Where-Object status -eq 'Already in QuickBooks')
    Write-Host ''
    Box @(("Ready to record         {0,5}" -f $ready.Count), ("Already in QuickBooks   {0,5}" -f $dups.Count), ("With problems           {0,5}" -f $probs.Count)) 'White' $(if ($probs.Count) { 'DarkRed' } else { 'DarkBlue' }) 'SUMMARY'
    foreach ($x in $plan) { if ($x.status -ne 'Ready') { Note (KeyOf $x) (KindOf $x) $x.label $x.status $x.txn ($x.msgs -join '; ') } }
  
    if ($CheckOnly) { Say 'Check only: nothing was written.' Yellow; foreach ($x in $ready) { Note (KeyOf $x) (KindOf $x) $x.label 'Ready' '' ($x.msgs -join '; ') } }
    elseif (-not $ready.Count) { Say 'Nothing to record.' Yellow }
    elseif (Ask "Record $(@($ready | Where-Object { -not $_.v }).Count) item(s) in QuickBooks now$(if (@($ready | Where-Object { $_.v }).Count) { ' (voids are asked separately)' })?") {
      Say ''
      $recordedInv = @{}; $stopped = ''
      foreach ($x in $ready) {
        if (-not $x.i) { continue }
        if ($stopped) { Note $x.i.key 'invoice' $x.label 'Ready' '' 'not recorded (QuickBooks stopped before this one)'; continue }
        $i = $x.i; $addr = ''; $k = 1
        foreach ($ln in @($i.billTo)) { if ($k -le 5 -and $ln) { $addr += "<Addr$k>$(X ("$ln".Substring(0, [math]::Min(41, "$ln".Length))))</Addr$k>"; $k++ } }
        $terms = if ($i.terms) { "<TermsRef><FullName>$(X $i.terms)</FullName></TermsRef>" } else { '' }
        $due = if ($i.dueDate) { "<DueDate>$($i.dueDate)</DueDate>" } else { '' }
        $memo = "<Memo>$(X (Mark $i.memo $i.key))</Memo>"
        $body = "<InvoiceAddRq><InvoiceAdd><CustomerRef><FullName>$(X $i.customer)</FullName></CustomerRef><TxnDate>$($i.date)</TxnDate><RefNumber>$(X $i.number)</RefNumber>$(if ($addr) { "<BillAddress>$addr</BillAddress>" })<IsPending>false</IsPending>$terms$due$memo$($x.lines)</InvoiceAdd></InvoiceAddRq>"
        $rs = $null; try { $rs = (Send $body).InvoiceAddRs } catch { $stopped = $_.Exception.Message }
        if ($stopped) { Write-Host '  ' -NoNewline; Write-Host ' STOPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Red; Note $i.key 'invoice' $x.label 'Problem' '' 'QuickBooks stopped while this was being recorded: check in QuickBooks whether it was saved'; continue }
        Start-Sleep -Milliseconds 400   # let QuickBooks finish its own work between entries
        if ($rs.statusCode -ne '0' -and $terms -and "$($rs.statusMessage)" -match 'Terms') { $rs = (Send $body.Replace($terms, '')).InvoiceAddRs }   # unknown terms name: retry without it
        if ($rs.statusCode -eq '0') { $t = $rs.InvoiceRet.TxnID; $recordedInv["$($i.customer)|$($i.number)"] = $t; Write-Host '  ' -NoNewline; Write-Host ' RECORDED ' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host "  $($x.label)  ($t)" -ForegroundColor Green; Note $i.key 'invoice' $x.label 'Recorded' $t ($x.msgs -join '; ') }
        else { Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $($rs.statusMessage)" -ForegroundColor Red; Note $i.key 'invoice' $x.label 'Problem' '' "QuickBooks said: $($rs.statusMessage)" }
      }
      foreach ($x in $ready) {
        if (-not $x.p) { continue }
        if ($stopped) { Note $x.p.key 'payment' $x.label 'Ready' '' 'not recorded (QuickBooks stopped before this one)'; continue }
        $p = $x.p; $appXml = ''; $bad = ''
        foreach ($a in $x.apps) {
          $t = $a.txn; if (-not $t) { $t = $recordedInv["$($p.customer)|$($a.inv)"] }
          if (-not $t) { $bad = "invoice $($a.inv) was not recorded in this run"; break }
          $appXml += "<AppliedToTxnAdd><TxnID>$t</TxnID><PaymentAmount>$($a.amount)</PaymentAmount></AppliedToTxnAdd>"
        }
        if ($bad) { Write-Host '  ' -NoNewline; Write-Host ' SKIPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $bad" -ForegroundColor Red; Note $p.key 'payment' $x.label 'Problem' '' $bad; continue }
        $ref = if ($p.ref) { "<RefNumber>$(X $p.ref)</RefNumber>" } else { '' }
        $memo = "<Memo>$(X (Mark $p.memo $p.key))</Memo>"
        $body = "<ReceivePaymentAddRq><ReceivePaymentAdd><CustomerRef><FullName>$(X $p.customer)</FullName></CustomerRef><TxnDate>$($p.date)</TxnDate>$ref<TotalAmount>$($p.amount)</TotalAmount>$memo<DepositToAccountRef><FullName>$(X $p.depositTo)</FullName></DepositToAccountRef>$appXml</ReceivePaymentAdd></ReceivePaymentAddRq>"
        $rs = $null; try { $rs = (Send $body).ReceivePaymentAddRs } catch { $stopped = $_.Exception.Message }
        if ($stopped) { Write-Host '  ' -NoNewline; Write-Host ' STOPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Red; Note $p.key 'payment' $x.label 'Problem' '' 'QuickBooks stopped while this was being recorded: check in QuickBooks whether it was saved'; continue }
        Start-Sleep -Milliseconds 400
        if ($rs.statusCode -eq '0') { $t = $rs.ReceivePaymentRet.TxnID; Write-Host '  ' -NoNewline; Write-Host ' RECORDED ' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host "  $($x.label)  ($t)" -ForegroundColor Green; Note $p.key 'payment' $x.label 'Recorded' $t ($x.msgs -join '; ') }
        else { Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $($rs.statusMessage)" -ForegroundColor Red; Note $p.key 'payment' $x.label 'Problem' '' "QuickBooks said: $($rs.statusMessage)" }
      }
      foreach ($x in $ready) {
        if (-not $x.b) { continue }
        if ($stopped) { Note $x.b.key 'bank' $x.label 'Ready' '' 'not recorded (QuickBooks stopped before this one)'; continue }
        $rs = $null; try { $rs = (Send $x.xml).ChildNodes | Select-Object -First 1 } catch { $stopped = $_.Exception.Message }
        if ($stopped) { Write-Host '  ' -NoNewline; Write-Host ' STOPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Red; Note $x.b.key 'bank' $x.label 'Problem' '' 'QuickBooks stopped while this was being recorded: check in QuickBooks whether it was saved'; continue }
        Start-Sleep -Milliseconds 700   # 1.61: a little longer; QuickBooks stopped after about 50 entries in a row
        $t = ''; if ($rs -and $rs.statusCode -eq '0') { foreach ($n in $rs.ChildNodes) { if ($n.TxnID) { $t = "$($n.TxnID)" } } }
        if ($t) { Write-Host '  ' -NoNewline; Write-Host ' RECORDED ' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host "  $($x.label)  ($t)" -ForegroundColor Green; Note $x.b.key 'bank' $x.label 'Recorded' $t ($x.msgs -join '; ') }
        else { $why = $(if ($rs) { "$($rs.statusMessage)" } else { 'no answer' }); Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $why" -ForegroundColor Red; Note $x.b.key 'bank' $x.label 'Problem' '' "QuickBooks said: $why" }
      }
      $edits = @($ready | Where-Object { $_.u }); $vds = @($ready | Where-Object { $_.v })
      foreach ($x in $edits) {
        if ($stopped) { Note $x.u.key 'update' $x.label 'Ready' '' 'not changed (QuickBooks stopped before this one)'; continue }
        $rs = $null; try { $rs = (Send $x.xml).ChildNodes | Select-Object -First 1 } catch { $stopped = $_.Exception.Message }
        if ($stopped) { Write-Host '  ' -NoNewline; Write-Host ' STOPPED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Red; Note $x.u.key 'update' $x.label 'Problem' $x.txn 'QuickBooks stopped while this was being changed: check it in QuickBooks'; continue }
        Start-Sleep -Milliseconds 200
        if ($rs -and $rs.statusCode -eq '0') { Write-Host '  ' -NoNewline; Write-Host ' CHANGED  ' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Green; Note $x.u.key 'update' $x.label 'Updated' $x.txn ($x.msgs -join '; ') }
        else {
          $why = $(if ($rs) { "$($rs.statusMessage)" } else { 'no answer' })
          if ($rs -and "$($rs.statusCode)" -eq '3200') { $why = 'changed in QuickBooks after the export - export again in VaultBook and compare ( ' + $why + ' )' }
          Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $why" -ForegroundColor Red; Note $x.u.key 'update' $x.label 'Problem' $x.txn "QuickBooks said: $why"
        }
      }
      if ($vds.Count -and -not $stopped) {
        Section 'VOIDS'
        foreach ($x in $vds) { Say "  $($x.label)" White }
        if (Ask "Void these $($vds.Count) transaction(s) in QuickBooks? (they stay in QuickBooks with amount 0)") {
          foreach ($x in $vds) {
            $rs = $null; try { $rs = (Send $x.xml).TxnVoidRs } catch { $stopped = $_.Exception.Message; break }
            if ($rs -and $rs.statusCode -eq '0') { Write-Host '  ' -NoNewline; Write-Host '  VOIDED  ' -ForegroundColor Black -BackgroundColor Green -NoNewline; Write-Host "  $($x.label)" -ForegroundColor Green; Note $x.v.key 'void' $x.label 'Voided' $x.txn '' }
            else { $why = $(if ($rs) { "$($rs.statusMessage)" } else { 'no answer' }); Write-Host '  ' -NoNewline; Write-Host '  FAILED  ' -ForegroundColor White -BackgroundColor DarkRed -NoNewline; Write-Host "  $($x.label): $why" -ForegroundColor Red; Note $x.v.key 'void' $x.label 'Problem' $x.txn "QuickBooks said: $why" }
          }
        } else { foreach ($x in $vds) { Note $x.v.key 'void' $x.label 'Ready' $x.txn 'not voided (you answered No)' } }
      }
      if ($stopped) {
        $nRec = @($results | Where-Object status -eq 'Recorded').Count
        Write-Host ''
        Box @('QuickBooks stopped answering part-way.', "Recorded before it stopped: $nRec. The others were NOT recorded.",
              '', 'What to do:', '1. Reopen QuickBooks and the company file. Choose Window > Close All.',
              '2. Look at the entry marked STOPPED above: if QuickBooks saved it, leave it; if not, it will be offered again.',
              '3. Run 5 What QuickBooks has, load the snapshot in VaultBook, and send again: only what is still missing is sent.',
              '', 'QuickBooks said: ' + $stopped) 'White' 'DarkRed' 'QUICKBOOKS STOPPED'
        $fatal = $true
      }
    }
    else { Say 'Nothing was written.' Yellow; foreach ($x in $ready) { Note (KeyOf $x) (KindOf $x) $x.label 'Ready' '' 'not recorded (you answered No)' } }
  }
  if ($Mode -eq 'Cycle') { Say ''; Say 'Reading QuickBooks again...' Cyan; $snapAfter = DoRead '-after' }
}
catch {
  Write-Host ''
  Box @('Stopped: ' + $_.Exception.Message, '', 'Is QuickBooks open with the company file?', 'First time: Admin, single-user mode, allow access when asked.') 'White' 'DarkRed' 'PROBLEM'
  Say "  at: $($_.InvocationInfo.PositionMessage)" DarkGray
  $fatal = $true
}
finally {
  if ($ticket) { try { $rp.EndSession($ticket) } catch {} }
  try { $rp.CloseConnection() } catch {}
}

# ---- result file for VaultBook (also after a failure, so VaultBook learns what was recorded) ----
if (-not $doSend -or -not $results.Count) {
  if ($exportFile -and -not $Linked) { Write-Host ''; Box @('In VaultBook: QuickBooks Desktop > 1 Import everything', 'and choose this file:', $exportFile) 'Black' 'Cyan' 'NEXT STEP' }
  if ($script:reportFiles.Count) { Write-Host ''; Box (@('Saved ' + $script:reportFiles.Count + ' file(s). They open in Excel:') + @($script:reportFiles)) 'Black' 'Cyan' 'EXPORTED' }
  if ($script:removeFile) { Write-Host ''; Box @('In VaultBook: Send to QuickBooks > Load snapshot or result file', 'and choose this record. The removed entries can then be sent again:', $script:removeFile) 'Black' 'Cyan' 'NEXT STEP' }
  if ($snapBefore -or $snapAfter) { Write-Host ''; Box @('In VaultBook: QuickBooks Desktop > 2 Read & months', '> Load snapshot or result file, and choose:', $(if ($snapAfter) { $snapAfter } else { $snapBefore })) 'Black' 'Cyan' 'NEXT STEP' }
  if ($fatal) { exit 1 }; exit 0
}
$out = [IO.Path]::Combine([IO.Path]::GetDirectoryName($Batch), [IO.Path]::GetFileNameWithoutExtension($Batch) + '.result.json')
$res = [pscustomobject]@{ format = 'vaultbook-qb-result'; version = 3; company = "$($data.company)"; batch = [IO.Path]::GetFileName($Batch); at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); items = @($results.ToArray()) }
[IO.File]::WriteAllText($out, (ToJson $res), (New-Object System.Text.UTF8Encoding $false))
$results | Export-Csv -LiteralPath ([IO.Path]::ChangeExtension($out, '.csv')) -NoTypeInformation -Encoding UTF8
Write-Host ''
$next = $(if ($Linked) { @('The result goes back to VaultBook now.', $out) } else { @('In VaultBook: QuickBooks Desktop > Load snapshot or result file', 'and choose the result:', $out) })
if ($snapAfter) { $next += @('', 'Then load the new snapshot too:', $snapAfter) }
Box $next 'Black' 'Cyan' 'NEXT STEP'
$n = @($results | Where-Object status -eq 'Problem').Count
if ($fatal) { exit 1 } elseif ($n) { exit 3 } else { exit 0 }
