# MT Mortise and Tenon - Project Mappenstructuur Generator
# Met Moneybird API integratie (token uit config.json)
# Projectnaam is placeholder - wordt later hernoemd

param(
    [string]$Klantcode = "",
    [string]$Vestiging = ""
)

# Load config
$configPath = Join-Path $PSScriptRoot "config.json"
if (-not (Test-Path $configPath)) {
    Write-Host "FOUT: config.json niet gevonden" -ForegroundColor Red
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$MBToken = $config.moneybird_token
$MBAdminId = "342968480452052559"
$MBApiUrl = "https://moneybird.com/api/v2/$MBAdminId"
$TestDir = "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Nieuwe mappenstructuur"
$Subfolders = @("01_Offerte", "02_Ontwerp", "03_Vectorworks", "04_Holzher", "05_Aangeleverd", "06_Fotos", "07_Administratie", "08_Archief", "09_Werktekeningen")

$KlantMap = @{
    "CN" = "CompaNanny"
    "LGM" = "LGM"
    "MOS" = "Meubelinterieur"
    "STY" = "Styles"
    "HWC" = "Inter Projecten"
    "DV" = "David"
    "JAN" = "Margret Jans"
}

function Get-MoneyBirdContact {
    param([string]$Search, [string]$Token)
    try {
        $headers = @{"Authorization" = "Bearer $Token"; "Content-Type" = "application/json"}
        $url = "$MBApiUrl/contacts.json"
        Write-Host "Moneybird zoeken: $Search..." -ForegroundColor Gray
        $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $headers -TimeoutSec 10

        if ($resp -and $resp.Count -gt 0) {
            $c = $resp | Where-Object {$_.company_name -like "*$Search*"} | Select-Object -First 1
            if (-not $c) {$c = $resp[0]}
            $addr = if ($c.address1) {"$($c.address1), $($c.city)"} else {$c.city}
            $custId = if ($c.customer_id) {$c.customer_id} else {$c.id}
            return @{name = $c.company_name; id = $custId; address = $addr}
        }
    } catch {
        Write-Host "API fout: $_" -ForegroundColor Red
    }
    return $null
}

function Get-StreetFromAddress {
    param([string]$Addr)
    if (-not $Addr) {return ""}
    $s = ($Addr -split ',')[0] -split "`n" | Select-Object -First 1
    return $s.Trim()
}

# Input: Klantcode
if (-not $Klantcode) {
    Write-Host ""
    Write-Host "MT Mortise and Tenon - Nieuw Project" -ForegroundColor Cyan
    Write-Host ""
    $Klantcode = Read-Host "Klantcode (CN/LGM/MOS/STY/HWC/DV/JAN)"
}

$search = if ($KlantMap[$Klantcode]) {$KlantMap[$Klantcode]} else {$Klantcode}
$contact = Get-MoneyBirdContact -Search $search -Token $MBToken

if (-not $contact) {
    Write-Host "FOUT: Contact niet gevonden: $search" -ForegroundColor Red
    exit 1
}

Write-Host "Gevonden: $($contact.name) (ID: $($contact.id))" -ForegroundColor Green

# Input: Vestiging
if (-not $Vestiging) {
    $Vestiging = Read-Host "Vestiging (bijv. Oosterpark, Prinsengracht)"
}

# Projectnaam is placeholder
$Project = "Projectnaam"
Write-Host "Projectnaam: $Project (placeholder - later hernoemd)" -ForegroundColor Yellow

# Bepaal mapnaam
$isCompaNanny = $contact.name -like "*CompaNanny*"
if ($isCompaNanny) {
    $street = Get-StreetFromAddress -Addr $contact.address
    $custFolder = "$($contact.name) - $street - $($contact.id)"
} else {
    $custFolder = "$($contact.name) - $($contact.id)"
}

$projFolder = "$Klantcode-$Vestiging-$Project"
$custPath = Join-Path $TestDir $custFolder
$projPath = Join-Path $custPath $projFolder

if (Test-Path $projPath) {
    Write-Host "FOUT: Map bestaat al" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $custPath)) {
    New-Item -ItemType Directory -Path $custPath -Force | Out-Null
    Write-Host "Klant-map aangemaakt" -ForegroundColor Green
}

New-Item -ItemType Directory -Path $projPath -Force | Out-Null
Write-Host "Project-map aangemaakt" -ForegroundColor Green

Write-Host ""
foreach ($sf in $Subfolders) {
    $sfp = Join-Path $projPath $sf
    New-Item -ItemType Directory -Path $sfp -Force | Out-Null
    Write-Host "  + $sf"
}

$info = Join-Path $projPath "PROJECT_INFO.txt"
$ts = Get-Date -Format 'dd-MM-yyyy HH:mm:ss'
$addr = if ($contact.address) {$contact.address} else {"(geen adres)"}

$txt = @"
PROJECTNAAM: $Klantcode - $Vestiging - $Project
Klant: $($contact.name)
Moneybird ID: $($contact.id)
Adres: $addr
Datum: $ts

MAPPEN:
01_Offerte - Offertes en aanvragen
02_Ontwerp - Ontwerpen en concept
03_Vectorworks - Vectorworks + CSV exports
04_Holzher - Holzher optimalisatie, HHA, NCR
05_Aangeleverd - Eindproduct, leveringsdetails
06_Fotos - Foto's en documentatie
07_Administratie - Facturen, communicatie
08_Archief - Gearchiveerde items
09_Werktekeningen - Werktekeningen en detailtekeningen
"@

Set-Content -Path $info -Value $txt -Encoding UTF8

Write-Host ""
Write-Host "Klaar!" -ForegroundColor Green
Write-Host "Klant-map: $custFolder"
Write-Host "Project-map: $projFolder"
Write-Host ""
Write-Host "Locatie: $projPath"
