# MT Mortise and Tenon - Project Mappenstructuur Generator
# PowerShell script voor aanmaken van projectmappen met standaard-structuur

param(
    [string]$Klant,
    [string]$Vestiging,
    [string]$Project,
    [string]$Adres = ""
)

# Standaard-instellingen
$BaseNAS = "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Nieuwe mappenstructuur"
$Subfolders = @("01_Offerte", "02_Ontwerp", "03_Vectorworks", "04_Holzher", "05_Aangeleverd", "06_Fotos", "07_Administratie", "08_Archief")

# Moneybird Contact Data (klantcodes naar nummers)
$Contacts = @{
    "CN"  = "CompaNanny"
    "LGM" = "1235"
    "MOS" = "33"
    "STY" = "1296"
    "HWC" = "207"
    "EZ"  = ""
    "GBK" = ""
    "DV"  = "1273"
    "JAN" = "1285"
}

# Als parameters niet meegegeven: interactief inputvragen
if (-not $Klant) {
    Write-Host "MT Mortise and Tenon - Project aanmaken" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Beschikbare klanten: CN, LGM, MOS, STY, HWC, EZ, GBK, DV, JAN"
    $Klant = Read-Host "Klantcode"
}

if (-not $Vestiging) {
    $Vestiging = Read-Host "Vestiging/Locatie (bijv. Prinsengracht, Oosterpark)"
}

if (-not $Project) {
    $Project = Read-Host "Projectnaam/Product (bijv. Garderobe, Pantry, Kast)"
}

# Construct mappennaam: KLANT-VESTIGING-PROJECT
$ProjectFolder = "$Klant-$Vestiging-$Project"
$ProjectPath = Join-Path $BaseNAS $ProjectFolder

# Check of map al bestaat
if (Test-Path $ProjectPath) {
    Write-Host "Waarschuwing: Map bestaat al: $ProjectPath" -ForegroundColor Yellow
    exit 1
}

# Maak project-map aan
Write-Host ""
Write-Host "Mappenstructuur aanmaken:" -ForegroundColor Green
Write-Host "-> $ProjectPath"
New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null

# Maak subfolders aan
foreach ($subfolder in $Subfolders) {
    $subpath = Join-Path $ProjectPath $subfolder
    New-Item -ItemType Directory -Path $subpath -Force | Out-Null
    Write-Host "  OK $subfolder"
}

# Maak info-bestand aan
$infofile = Join-Path $ProjectPath "PROJECT_INFO.txt"
$timestamp = Get-Date -Format 'dd-MM-yyyy HH:mm:ss'

# Bouw info-tekst
$Lines = @(
    "Projectnaam: $Klant - $Vestiging - $Project",
    "Datum aangemaakt: $timestamp",
    "Adres: $Adres",
    "",
    "Mappen:",
    "01_Offerte       - Offertes en aanvragen",
    "02_Ontwerp       - Ontwerpen en concept",
    "03_Vectorworks   - Vectorworks bestanden + CSV exports",
    "04_Holzher       - Holzher optimalisatie, HHA, NCR bestanden",
    "05_Aangeleverd   - Eindproduct, leveringsdetails",
    "06_Fotos         - Foto's (vooraf, werkproces, oplevering)",
    "07_Administratie - Facturen, communicatie",
    "08_Archief       - Gearchiveerde items"
)

$infotext = $Lines -join [Environment]::NewLine
Set-Content -Path $infofile -Value $infotext -Encoding UTF8
Write-Host "  OK PROJECT_INFO.txt"

Write-Host ""
Write-Host "Klaar! Map aangemaakt:" -ForegroundColor Green
Write-Host "   $ProjectPath"
Write-Host ""
