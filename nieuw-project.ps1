#Requires -Version 5.1
<#
.SYNOPSIS
    MT Mortise and Tenon - Project Mappenstructuur Generator
    Met Moneybird API integratie. Token, admin-ID en basispad uit config.json.

.PARAMETER Klantcode
    Kortcode van de klant (bijv. CN, LGM). Optioneel — wordt interactief gevraagd.

.PARAMETER Vestiging
    Vestigingsnaam voor de projectmap (bijv. Oosterpark). Optioneel.

.EXAMPLE
    .\nieuw-project.ps1 -Klantcode CN -Vestiging Oosterpark
#>

param(
    [string]$Klantcode = "",
    [string]$Vestiging = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constanten
# ---------------------------------------------------------------------------
$Subfolders = @(
    "01_Offerte",
    "02_Ontwerp",
    "03_Vectorworks",
    "04_Holzher",
    "05_Aangeleverd",
    "06_Fotos",
    "07_Administratie",
    "08_Archief",
    "09_Werktekeningen"
)

$KlantMap = @{
    "CN"  = "CompaNanny"
    "LGM" = "LGM"
    "MOS" = "Meubelinterieur"
    "STY" = "Styles"
    "HWC" = "Inter Projecten"
    "DV"  = "David"
    "JAN" = "Margret Jans"
}

# ---------------------------------------------------------------------------
# Config laden
# ---------------------------------------------------------------------------
$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Host "FOUT: config.json niet gevonden op: $configPath" -ForegroundColor Red
    exit 1
}

try {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Host "FOUT: config.json is geen geldige JSON: $_" -ForegroundColor Red
    exit 1
}

foreach ($key in @('moneybird_token', 'moneybird_admin_id', 'base_dir')) {
    if (-not $config.$key -or [string]::IsNullOrWhiteSpace($config.$key)) {
        Write-Host "FOUT: config.json mist of heeft leeg veld: '$key'" -ForegroundColor Red
        exit 1
    }
}

$MBToken   = $config.moneybird_token
$MBAdminId = $config.moneybird_admin_id
$MBApiBase = "https://moneybird.com/api/v2/$MBAdminId"
$BaseDir   = $config.base_dir

# ---------------------------------------------------------------------------
# Hulpfuncties
# ---------------------------------------------------------------------------

function Invoke-MBApi {
    param(
        [string]$Url,
        [string]$Token,
        [int]$MaxRetries = 3,
        [int]$RetryDelaySeconds = 2
    )
    $headers = @{
        "Authorization" = "Bearer $Token"
        "Content-Type"  = "application/json"
    }
    $attempt = 0
    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            return Invoke-RestMethod -Uri $Url -Method Get -Headers $headers -TimeoutSec 15 -ErrorAction Stop
        } catch {
            $statusCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
            if ($statusCode -in @(401, 403)) {
                Write-Host "FOUT: API-authenticatie mislukt (HTTP $statusCode). Controleer je token." -ForegroundColor Red
                exit 1
            }
            if ($attempt -lt $MaxRetries) {
                Write-Host "  Poging $attempt mislukt ($statusCode). Opnieuw over ${RetryDelaySeconds}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $RetryDelaySeconds
            } else {
                Write-Host "FOUT: API niet bereikbaar na $MaxRetries pogingen. Laatste fout: $_" -ForegroundColor Red
                return $null
            }
        }
    }
}

function Get-SafePathName {
    param([string]$Name, [int]$MaxLength = 80)
    $safe = $Name -replace '[\\/:*?"<>|]', '-'
    $safe = $safe.Trim('. ')
    if ($safe.Length -gt $MaxLength) { $safe = $safe.Substring(0, $MaxLength).TrimEnd('. ') }
    return $safe
}

function Get-MoneyBirdContact {
    param([string]$Search, [string]$Token)
    $encodedSearch = [Uri]::EscapeDataString($Search)
    $url = "$MBApiBase/contacts.json?query=$encodedSearch"
    Write-Host "Moneybird zoeken naar: $Search..." -ForegroundColor Gray
    $resp = Invoke-MBApi -Url $url -Token $Token
    if (-not $resp -or $resp.Count -eq 0) { return $null }
    $contact = $resp | Where-Object { $_.company_name -ieq $Search } | Select-Object -First 1
    if (-not $contact) { $contact = $resp | Select-Object -First 1 }
    $addr   = if ($contact.address1) { "$($contact.address1), $($contact.city)" } else { $contact.city }
    $custId = if ($contact.customer_id) { $contact.customer_id } else { $contact.id }
    return @{ name = $contact.company_name; id = $custId; address = $addr }
}

function Get-StreetFromAddress {
    param([string]$Addr)
    if (-not $Addr) { return "" }
    return (($Addr -split ',')[0] -split "`n" | Select-Object -First 1).Trim()
}

function Assert-PathLength {
    param([string]$Path)
    if ($Path.Length -ge 260) {
        Write-Host "FOUT: Pad te lang ($($Path.Length) tekens, max 260): $Path" -ForegroundColor Red
        exit 1
    } elseif ($Path.Length -ge 240) {
        Write-Host "WAARSCHUWING: Pad nadert Windows-limiet ($($Path.Length)/260 tekens)" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# Hoofdlogica
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "MT Mortise and Tenon - Nieuw Project" -ForegroundColor Cyan
Write-Host ""

if (-not $Klantcode) {
    $Klantcode = (Read-Host "Klantcode (CN/LGM/MOS/STY/HWC/DV/JAN, of vrije zoekterm)").Trim()
}
if ([string]::IsNullOrWhiteSpace($Klantcode)) {
    Write-Host "FOUT: Geen klantcode opgegeven." -ForegroundColor Red; exit 1
}

$search  = if ($KlantMap.ContainsKey($Klantcode)) { $KlantMap[$Klantcode] } else { $Klantcode }
$contact = Get-MoneyBirdContact -Search $search -Token $MBToken
if (-not $contact) {
    Write-Host "FOUT: Geen contact gevonden voor '$search' in Moneybird." -ForegroundColor Red; exit 1
}
Write-Host "Gevonden: $($contact.name) (ID: $($contact.id))" -ForegroundColor Green

if (-not $Vestiging) {
    $Vestiging = (Read-Host "Vestiging (bijv. Oosterpark, Prinsengracht)").Trim()
}
if ([string]::IsNullOrWhiteSpace($Vestiging)) {
    Write-Host "FOUT: Geen vestiging opgegeven." -ForegroundColor Red; exit 1
}

# Mapnamen bouwen
$safeName      = Get-SafePathName -Name $contact.name
$safeVestiging = Get-SafePathName -Name $Vestiging
$isCompaNanny  = $contact.name -like "*CompaNanny*"

if ($isCompaNanny) {
    $street     = Get-SafePathName -Name (Get-StreetFromAddress -Addr $contact.address)
    $custFolder = "$safeName - $street - $($contact.id)"
} else {
    $custFolder = "$safeName - $($contact.id)"
}

$Project    = "Projectnaam"
$projFolder = "$Klantcode-$safeVestiging-$Project"
$custPath   = Join-Path $BaseDir $custFolder
$projPath   = Join-Path $custPath $projFolder

Assert-PathLength -Path $projPath

if (Test-Path $projPath) {
    Write-Host "FOUT: Projectmap bestaat al: $projPath" -ForegroundColor Red; exit 1
}

if (-not (Test-Path $custPath)) {
    New-Item -ItemType Directory -Path $custPath -Force | Out-Null
    Write-Host "Klant-map aangemaakt: $custFolder" -ForegroundColor Green
} else {
    Write-Host "Klant-map bestaat al (hergebruikt): $custFolder" -ForegroundColor Gray
}

New-Item -ItemType Directory -Path $projPath -Force | Out-Null
Write-Host "Project-map aangemaakt: $projFolder" -ForegroundColor Green

foreach ($sf in $Subfolders) {
    New-Item -ItemType Directory -Path (Join-Path $projPath $sf) -Force | Out-Null
    Write-Host "  + $sf"
}

# PROJECT_INFO.txt
$ts       = Get-Date -Format 'dd-MM-yyyy HH:mm:ss'
$addr     = if ($contact.address) { $contact.address } else { "(geen adres)" }
$wikiSlug = $contact.name.ToLower() -replace '[^a-z0-9\s-]', '' -replace '\s+', '-'

$infoContent = @"
PROJECTNAAM: $Klantcode - $safeVestiging - $Project
Klant: $($contact.name)
Moneybird ID: $($contact.id)
Adres: $addr
Aangemaakt: $ts

MAPPEN:
01_Offerte        — Offertes en aanvragen
02_Ontwerp        — Ontwerpen en concept
03_Vectorworks    — Vectorworks + CSV exports
04_Holzher        — Holzher optimalisatie, HHA, NCR
05_Aangeleverd    — Eindproduct, leveringsdetails
06_Fotos          — Foto's en documentatie
07_Administratie  — Facturen, communicatie
08_Archief        — Gearchiveerde items
09_Werktekeningen — Werktekeningen en detailtekeningen

--MYPKA--
Wikilink: [[$wikiSlug]]
Moneybird_ID: $($contact.id)
Klantcode: $Klantcode
"@

Set-Content -Path (Join-Path $projPath "PROJECT_INFO.txt") -Value $infoContent -Encoding UTF8

Write-Host ""
Write-Host "Klaar!" -ForegroundColor Green
Write-Host "Klant-map  : $custFolder"
Write-Host "Project-map: $projFolder"
Write-Host "Locatie    : $projPath"
