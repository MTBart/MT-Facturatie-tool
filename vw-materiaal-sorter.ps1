#Requires -Version 5.1
<#
.SYNOPSIS
    VW Materiaal Sorter — routeert Vectorworks CSV-exports naar de juiste projectmap.

.DESCRIPTION
    Scant een inbox-map op CSV-bestanden die uit Vectorworks zijn geëxporteerd.
    Matcht de projectcode in de bestandsnaam aan een projectmap op de NAS.
    Kopieert de CSV naar de 03_Vectorworks/ submap van dat project.
    Maakt een bewerkbare tussenstap-CSV aan die klaarstaat voor Toggl-verwerking.
    Verplaatst verwerkte bestanden naar _Verwerkt/.

.PARAMETER ConfigPath
    Pad naar vw-sorter-config.json. Standaard: script-map\vw-sorter-config.json

.PARAMETER DryRun
    Toont wat er zou gebeuren zonder iets te verplaatsen of aan te maken.

.EXAMPLE
    .\vw-materiaal-sorter.ps1
    .\vw-materiaal-sorter.ps1 -DryRun
    .\vw-materiaal-sorter.ps1 -ConfigPath "C:\pad\naar\config.json"

.NOTES
    Auteur  : Larry / myPKA voor Mortise & Tenon
    Versie  : 1.0
    Datum   : 2026-05-21
#>

[CmdletBinding()]
param(
    [string]$ConfigPath = "",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SCRIPT_VERSION = "1.0"

# ─────────────────────────────────────────────
# CONSOLE OUTPUT HELPERS
# ─────────────────────────────────────────────
function Write-Ok   { param([string]$Msg) Write-Host "[OK]     $Msg" -ForegroundColor Green }
function Write-Skip { param([string]$Msg) Write-Host "[SKIP]   $Msg" -ForegroundColor Yellow }
function Write-Warn { param([string]$Msg) Write-Host "[WARN]   $Msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$Msg) Write-Host "[ERROR]  $Msg" -ForegroundColor Red }
function Write-Info { param([string]$Msg) Write-Host "[INFO]   $Msg" -ForegroundColor Cyan }
function Write-Dry  { param([string]$Msg) Write-Host "[DRYRUN] $Msg" -ForegroundColor Magenta }

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║   Mortise & Tenon — VW Materiaal Sorter v$SCRIPT_VERSION          ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# ─────────────────────────────────────────────
# CONFIG LADEN
# ─────────────────────────────────────────────
function Get-Config {
    param([string]$Path)

    if ([string]::IsNullOrEmpty($Path)) {
        $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.ScriptName }
        $Path = Join-Path $scriptDir "vw-sorter-config.json"
    }

    if (-not (Test-Path $Path)) {
        throw "Config niet gevonden: $Path`nKopieer vw-sorter-config-template.json naar vw-sorter-config.json en vul je paden in."
    }

    $cfg = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json

    # Verplichte velden
    foreach ($field in @('inbox_folder', 'project_roots', 'log_file')) {
        if (-not $cfg.$field) {
            throw "Verplicht veld '$field' ontbreekt in config."
        }
    }

    return $cfg
}

# ─────────────────────────────────────────────
# PROJECTCODE EXTRAHEREN UIT BESTANDSNAAM
# ─────────────────────────────────────────────
function Get-ProjectCode {
    param([string]$FileName)

    # Verwijder extensie
    $base = [System.IO.Path]::GetFileNameWithoutExtension($FileName)

    # Bekende suffixen die VW aan de export plakt — strip ze weg
    $knownSuffixes = @(
        '-materialen', '-materials', '-export', '-materiaallijst',
        '_materialen', '_materials', '_export', '_materiaallijst',
        '-worksheet', '_worksheet', '-report', '_report'
    )

    foreach ($suffix in $knownSuffixes) {
        if ($base -imatch "$([regex]::Escape($suffix))$") {
            $base = $base.Substring(0, $base.Length - $suffix.Length)
            break
        }
    }

    # Verwijder datum-achtervoegsel als dat er nog achter zit (bijv. -2026-05-21 of _20260521)
    $base = $base -replace '-\d{4}-\d{2}-\d{2}$', ''
    $base = $base -replace '_\d{8}$', ''

    return $base.Trim()
}

# ─────────────────────────────────────────────
# PROJECTMAP ZOEKEN
# ─────────────────────────────────────────────
function Find-ProjectFolder {
    param(
        [string]$ProjectCode,
        [string[]]$ProjectRoots,
        [string]$SubfolderName
    )

    $matches = [System.Collections.ArrayList]@()

    foreach ($root in $ProjectRoots) {
        if (-not (Test-Path $root)) {
            Write-Warn "Project root bestaat niet (overgeslagen): $root"
            continue
        }

        # Zoek twee niveaus diep: root\klant\project\
        # Niveau 1: klantmappen
        $klantFolders = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue

        foreach ($klantFolder in $klantFolders) {
            # Niveau 2: projectmappen binnen klantmap
            $projectFolders = Get-ChildItem -Path $klantFolder.FullName -Directory -ErrorAction SilentlyContinue

            foreach ($projFolder in $projectFolders) {
                $folderName = $projFolder.Name

                # Controleer of de projectcode in de mapnaam zit (case-insensitive)
                if ($folderName -imatch "^$([regex]::Escape($ProjectCode))(\b|_|-|$)") {
                    $targetSub = Join-Path $projFolder.FullName $SubfolderName
                    $null = $matches.Add([PSCustomObject]@{
                        ProjectFolder   = $projFolder.FullName
                        ProjectName     = $projFolder.Name
                        TargetSubfolder = $targetSub
                        KlantFolder     = $klantFolder.Name
                    })
                }
            }
        }
    }

    return $matches
}

# ─────────────────────────────────────────────
# TUSSENSTAP-CSV AANMAKEN
# ─────────────────────────────────────────────
function New-TussenstapFile {
    param(
        [string]$CsvSourcePath,
        [string]$TargetFolder,
        [string]$ProjectName,
        [bool]$IsDryRun
    )

    $datum         = Get-Date -Format "yyyy-MM-dd"
    $tussenstapPad = Join-Path $TargetFolder "materiaal-tussenstap-$datum.csv"

    if ($IsDryRun) {
        Write-Dry "ZOU tussenstap aanmaken: $tussenstapPad"
        return $tussenstapPad
    }

    # Lees de originele VW-CSV
    try {
        $vwData = Import-Csv -Path $CsvSourcePath -Encoding UTF8 -ErrorAction Stop
    } catch {
        try {
            $vwData = Import-Csv -Path $CsvSourcePath -Encoding Default -ErrorAction Stop
        } catch {
            Write-Warn "Kon CSV niet inlezen als tabel, kopieer raw: $_"
            Copy-Item $CsvSourcePath $tussenstapPad -Force
            return $tussenstapPad
        }
    }

    # Bouw tussenstap op: originele VW-kolommen + extra kolommen voor Toggl-voorbereiding
    $tussenstapRows = [System.Collections.ArrayList]@()

    foreach ($row in $vwData) {
        $props = [ordered]@{}
        foreach ($prop in $row.PSObject.Properties) {
            $props[$prop.Name] = $prop.Value
        }

        # Toggl-voorbereidingskolommen (leeg — invullen door Bart)
        $props['-- TOGGL VOORBEREIDING --'] = ''
        $props['Fase / taaknaam']           = ''
        $props['Geschatte uren']            = ''
        $props['Toegewezen aan']            = ''
        $props['Opmerkingen']               = ''
        $props['Verwerkt in Toggl']         = 'Nee'

        $tussenstapRows.Add([PSCustomObject]$props) | Out-Null
    }

    if ($tussenstapRows.Count -gt 0) {
        $tussenstapRows | Export-Csv -Path $tussenstapPad -Encoding UTF8 -NoTypeInformation -Force
        Write-Ok "Tussenstap aangemaakt: $(Split-Path -Leaf $tussenstapPad)"
    } else {
        [PSCustomObject]@{
            'Project'                   = $ProjectName
            'Aangemaakt'                = $datum
            'Status'                    = 'VW export was leeg — handmatig aanvullen'
            '-- TOGGL VOORBEREIDING --' = ''
            'Fase / taaknaam'           = ''
            'Geschatte uren'            = ''
            'Toegewezen aan'            = ''
            'Opmerkingen'               = ''
            'Verwerkt in Toggl'         = 'Nee'
        } | Export-Csv -Path $tussenstapPad -Encoding UTF8 -NoTypeInformation -Force
        Write-Warn "VW-export was leeg — tussenstap aangemaakt met lege template"
    }

    return $tussenstapPad
}

# ─────────────────────────────────────────────
# LOGBOEK
# ─────────────────────────────────────────────
function Write-LogEntry {
    param([string]$LogPath, [hashtable]$Entry)

    $log = [System.Collections.ArrayList]@()

    if (Test-Path $LogPath) {
        try {
            $existing = Get-Content $LogPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing -is [array]) { $log = [System.Collections.ArrayList]$existing }
            elseif ($null -ne $existing) { $log = [System.Collections.ArrayList]@($existing) }
        } catch { $log = [System.Collections.ArrayList]@() }
    }

    $null = $log.Add([PSCustomObject]$Entry)

    $logDir = Split-Path -Parent $LogPath
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

    $log | ConvertTo-Json -Depth 5 | Set-Content $LogPath -Encoding UTF8
}

# ─────────────────────────────────────────────
# HOOFD: SORTEER INBOX
# ─────────────────────────────────────────────
function Invoke-SortInbox {
    param($Config, [bool]$IsDryRun)

    $inboxFolder   = $Config.inbox_folder
    $projectRoots  = @($Config.project_roots)
    $subfolderName = if ($Config.subfolder_name) { $Config.subfolder_name } else { "03_Vectorworks" }
    $logPath       = $Config.log_file

    # Inbox aanmaken als die er nog niet is
    if (-not (Test-Path $inboxFolder)) {
        if ($IsDryRun) {
            Write-Dry "ZOU inbox aanmaken: $inboxFolder"
        } else {
            New-Item -ItemType Directory -Path $inboxFolder -Force | Out-Null
            Write-Ok "Inbox aangemaakt: $inboxFolder"
        }
    }

    # _Verwerkt en _Onbekend submappen
    $verwerktFolder = Join-Path $inboxFolder "_Verwerkt"
    $onbekendFolder = Join-Path $inboxFolder "_Onbekend"

    if (-not $IsDryRun) {
        foreach ($f in @($verwerktFolder, $onbekendFolder)) {
            if (-not (Test-Path $f)) { New-Item -ItemType Directory -Path $f -Force | Out-Null }
        }
    }

    # CSV-bestanden in inbox (alleen root, niet submappen)
    $csvFiles = Get-ChildItem -Path $inboxFolder -Filter "*.csv" -File -ErrorAction SilentlyContinue |
                Where-Object { $_.DirectoryName -eq $inboxFolder }

    if ($csvFiles.Count -eq 0) {
        Write-Info "Geen CSV-bestanden gevonden in inbox: $inboxFolder"
        Write-Info "Exporteer een materiaallijst uit Vectorworks naar deze map en draai het script opnieuw."
        return
    }

    Write-Info "$($csvFiles.Count) CSV-bestand(en) gevonden"

    $verwerkt = 0
    $onbekend = 0
    $fouten   = 0

    foreach ($csv in $csvFiles) {
        Write-Host ""
        Write-Info "Verwerken: $($csv.Name)"

        try {
            $projectCode = Get-ProjectCode -FileName $csv.Name
            Write-Info "Projectcode: $projectCode"

            if ([string]::IsNullOrEmpty($projectCode)) {
                Write-Skip "Kon geen projectcode bepalen — verplaatst naar _Onbekend"
                if (-not $IsDryRun) {
                    Move-Item $csv.FullName (Join-Path $onbekendFolder $csv.Name) -Force
                }
                $onbekend++
                continue
            }

            $gevonden = Find-ProjectFolder -ProjectCode $projectCode -ProjectRoots $projectRoots -SubfolderName $subfolderName

            if ($gevonden.Count -eq 0) {
                Write-Warn "Geen projectmap gevonden voor code: $projectCode"
                Write-Warn "Verplaatst naar _Onbekend — handmatig sorteren"
                if (-not $IsDryRun) {
                    Move-Item $csv.FullName (Join-Path $onbekendFolder $csv.Name) -Force
                }
                Write-LogEntry -LogPath $logPath -Entry @{
                    bestand     = $csv.Name
                    projectCode = $projectCode
                    resultaat   = 'onbekend'
                    reden       = "Geen projectmap gevonden"
                    tijdstip    = (Get-Date -Format 'o')
                }
                $onbekend++
                continue
            }

            if ($gevonden.Count -gt 1) {
                Write-Warn "$($gevonden.Count) matches voor '$projectCode' — gebruik de eerste:"
                $gevonden | ForEach-Object { Write-Warn "  → $($_.ProjectFolder)" }
            }

            $match = $gevonden[0]
            Write-Info "Match: $($match.ProjectName)"

            if ($IsDryRun) {
                Write-Dry "ZOU CSV kopiëren naar: $($match.TargetSubfolder)"
                Write-Dry "ZOU tussenstap aanmaken in: $($match.TargetSubfolder)"
                Write-Dry "ZOU origineel verplaatsen naar: $verwerktFolder"
                $verwerkt++
                continue
            }

            # Doelmap aanmaken als die er nog niet is
            if (-not (Test-Path $match.TargetSubfolder)) {
                New-Item -ItemType Directory -Path $match.TargetSubfolder -Force | Out-Null
                Write-Info "Submap aangemaakt: $subfolderName"
            }

            # CSV kopiëren
            $csvDoel = Join-Path $match.TargetSubfolder $csv.Name
            Copy-Item $csv.FullName $csvDoel -Force
            Write-Ok "CSV gekopieerd naar: $($match.TargetSubfolder)"

            # Tussenstap aanmaken
            $tussenstapPad = New-TussenstapFile `
                -CsvSourcePath $csv.FullName `
                -TargetFolder $match.TargetSubfolder `
                -ProjectName $match.ProjectName `
                -IsDryRun $false

            # Origineel naar _Verwerkt
            Move-Item $csv.FullName (Join-Path $verwerktFolder $csv.Name) -Force
            Write-Ok "Origineel verplaatst naar _Verwerkt"

            Write-LogEntry -LogPath $logPath -Entry @{
                bestand     = $csv.Name
                projectCode = $projectCode
                projectMap  = $match.ProjectFolder
                csvDoel     = $csvDoel
                tussenstap  = $tussenstapPad
                resultaat   = 'verwerkt'
                tijdstip    = (Get-Date -Format 'o')
            }

            $verwerkt++

        } catch {
            Write-Err "Fout bij verwerken van '$($csv.Name)': $_"
            $fouten++
        }
    }

    Write-Host ""
    Write-Host "────────────────────────────────────────────" -ForegroundColor Cyan
    if ($IsDryRun) {
        Write-Dry "DRY RUN: $verwerkt te verwerken, $onbekend onbekend, $fouten fouten"
    } else {
        Write-Ok "Klaar: $verwerkt verwerkt, $onbekend onbekend, $fouten fouten"
        if ($onbekend -gt 0) { Write-Warn "Kijk in '_Onbekend' voor handmatig te sorteren bestanden" }
        if ($verwerkt -gt 0) {
            Write-Info "Tussenstap-bestanden staan klaar in de $subfolderName submappen"
            Write-Info "Vul de 'Toggl voorbereiding' kolommen in en verwerk ze daarna"
        }
    }
    Write-Host "────────────────────────────────────────────" -ForegroundColor Cyan
}

# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
try {
    Write-Banner

    $config = Get-Config -Path $ConfigPath

    Write-Info "Inbox  : $($config.inbox_folder)"
    Write-Info "Roots  : $($config.project_roots -join ', ')"
    Write-Info "Submap : $(if ($config.subfolder_name) { $config.subfolder_name } else { '03_Vectorworks' })"
    if ($DryRun) { Write-Dry "DRY RUN modus — er wordt niets verplaatst of aangemaakt" }

    Invoke-SortInbox -Config $config -IsDryRun $DryRun.IsPresent

    exit 0

} catch {
    Write-Host ""
    Write-Err "Kritieke fout: $_"
    Write-Err "Regel: $($_.InvocationInfo.ScriptLineNumber)"
    exit 1
}
