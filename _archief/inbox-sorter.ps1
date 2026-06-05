#Requires -Version 5.1
<#
.SYNOPSIS
    Inbox-sorter voor Mortise & Tenon — sorteert info@mortiseandtenon.nl automatisch via Microsoft Graph API.

.DESCRIPTION
    Haalt ongelezen/recente mails op uit de gedeelde inbox van info@mortiseandtenon.nl en
    verplaatst ze naar de juiste submap op basis van de Moneybird-contactencache.
    Schrijft een undo-logboek voor herstel. Ondersteunt DryRun-modus.

.PARAMETER ConfigPath
    Pad naar config.json. Standaard: script-map\inbox-sorter-config.json

.PARAMETER DryRun
    Toont wat er zou gebeuren zonder iets te verplaatsen.

.PARAMETER Undo
    Zet alle verplaatste mails terug naar hun originele map op basis van inbox-sort-log.json.

.PARAMETER UpdateCache
    Haalt alle contacten opnieuw op via de Moneybird API en schrijft de cache opnieuw weg.

.EXAMPLE
    .\inbox-sorter.ps1
    .\inbox-sorter.ps1 -DryRun
    .\inbox-sorter.ps1 -Undo
    .\inbox-sorter.ps1 -UpdateCache

.NOTES
    Auteur  : Claude voor Mortise & Tenon
    Versie  : 1.0
    Datum   : 2026-05-18
#>

[CmdletBinding(DefaultParameterSetName = 'Sort')]
param(
    [Parameter(ParameterSetName = 'Sort')]
    [Parameter(ParameterSetName = 'DryRun')]
    [Parameter(ParameterSetName = 'UpdateCache')]
    [string]$ConfigPath = "",

    [Parameter(ParameterSetName = 'DryRun')]
    [switch]$DryRun,

    [Parameter(ParameterSetName = 'Undo')]
    [switch]$Undo,

    [Parameter(ParameterSetName = 'UpdateCache')]
    [switch]$UpdateCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ─────────────────────────────────────────────
# CONSTANTEN
# ─────────────────────────────────────────────
$SCRIPT_VERSION   = "1.0"
$GRAPH_BASE       = "https://graph.microsoft.com/v1.0"
$MONEYBIRD_BASE   = "https://moneybird.com/api/v2"
$MAX_RETRIES      = 3
$RETRY_DELAY_SEC  = 2
$MAX_MESSAGES     = 100   # mails per run ophalen

# CompaNanny vestigingen — aanvullen indien nieuwe vestigingen bijkomen
$COMPANANNY_KEYWORDS = @(
    'Bachzaal', 'Amstel', 'Benoordenhout', 'Olympia', 'Zuidas',
    'Centrum', 'Noord', 'West', 'Oost', 'Zuid', 'IJburg',
    'Watergraafsmeer', 'Buitenveldert', 'Rivierenbuurt', 'Jordaan',
    'De Pijp', 'Oud-Zuid', 'Oud West', 'OudWest'
)

# ─────────────────────────────────────────────
# HELPER: Kleurige console output
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
    Write-Host "║   Mortise & Tenon — Inbox Sorter v$SCRIPT_VERSION               ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# ─────────────────────────────────────────────
# HELPER: Pad-sanitizing
# ─────────────────────────────────────────────
function Get-SafePathName {
    <#
    .SYNOPSIS
        Verwijdert ongeldige tekens uit een bestandsnaam-component.
        Gebruik alleen voor folder/bestandsnamen, niet voor volledige paden.
    #>
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) { return '_Onbekend' }

    # Verwijder ongeldige Windows pad-tekens
    $invalid = [System.IO.Path]::GetInvalidFileNameChars()
    $safe    = $Name.Trim()
    foreach ($c in $invalid) {
        $safe = $safe.Replace([string]$c, '_')
    }

    # Extra sanitizing: geen dubbele spaties, geen trailing punt/spatie
    $safe = ($safe -replace '\s+', ' ').TrimEnd('.', ' ')

    if ([string]::IsNullOrWhiteSpace($safe)) { return '_Onbekend' }
    return $safe
}

# ─────────────────────────────────────────────
# HELPER: Config laden
# ─────────────────────────────────────────────
function Get-Config {
    param([string]$Path)

    if ([string]::IsNullOrEmpty($Path)) {
        # Zoek naast het script
        $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
        if ([string]::IsNullOrEmpty($scriptDir)) { $scriptDir = $PSScriptRoot }
        $Path = Join-Path $scriptDir "inbox-sorter-config.json"
    }

    if (-not (Test-Path $Path)) {
        throw "Config-bestand niet gevonden: $Path`nKopieer inbox-sorter-config-template.json naar inbox-sorter-config.json en vul je gegevens in."
    }

    try {
        $cfg = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Kon config.json niet inlezen: $_"
    }

    # Verplichte velden controleren
    $required = @('tenant_id','client_id','client_secret','shared_mailbox','contacts_cache','log_file')
    foreach ($field in $required) {
        $val = $cfg.$field
        if ([string]::IsNullOrWhiteSpace($val)) {
            throw "Verplicht veld '$field' ontbreekt of is leeg in $Path"
        }
    }

    return $cfg
}

# ─────────────────────────────────────────────
# GRAPH API: Token ophalen
# ─────────────────────────────────────────────
function Get-GraphToken {
    param($Config)

    Write-Info "Graph API token ophalen..."

    $tokenUrl = "https://login.microsoftonline.com/$($Config.tenant_id)/oauth2/v2.0/token"
    $body = @{
        grant_type    = 'client_credentials'
        client_id     = $Config.client_id
        client_secret = $Config.client_secret
        scope         = 'https://graph.microsoft.com/.default'
    }

    $response = Invoke-GraphRequest -Method POST -Uri $tokenUrl -Body $body -IsForm $true -Token $null
    if (-not $response.access_token) {
        throw "Geen access_token ontvangen van Azure AD. Controleer tenant_id, client_id en client_secret."
    }

    Write-Ok "Token ontvangen (geldig $($response.expires_in)s)"
    return $response.access_token
}

# ─────────────────────────────────────────────
# GRAPH API: HTTP-wrapper met retry
# ─────────────────────────────────────────────
function Invoke-GraphRequest {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Body = @{},
        [object]$JsonBody = $null,
        [string]$Token,
        [bool]$IsForm = $false
    )

    $attempt = 0
    while ($attempt -lt $MAX_RETRIES) {
        $attempt++
        try {
            $params = @{
                Method  = $Method
                Uri     = $Uri
                Headers = @{}
            }

            if (-not [string]::IsNullOrEmpty($Token)) {
                $params.Headers['Authorization'] = "Bearer $Token"
            }

            if ($IsForm) {
                $params['ContentType'] = 'application/x-www-form-urlencoded'
                $params['Body']        = $Body
            } elseif ($null -ne $JsonBody) {
                $params['ContentType'] = 'application/json'
                $params['Body']        = ($JsonBody | ConvertTo-Json -Depth 10 -Compress)
            }

            $result = Invoke-RestMethod @params
            return $result

        } catch {
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }

            # Throttling (429) of server-fout (5xx) → retry
            if ($attempt -lt $MAX_RETRIES -and ($statusCode -eq 429 -or ($statusCode -ge 500 -and $statusCode -lt 600))) {
                Write-Warn "Poging $attempt/$MAX_RETRIES mislukt (HTTP $statusCode). Wacht $($RETRY_DELAY_SEC)s..."
                Start-Sleep -Seconds $RETRY_DELAY_SEC
                continue
            }

            # Lees response body voor betere foutmelding
            $errBody = ""
            try {
                $reader  = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errBody = $reader.ReadToEnd()
                $reader.Close()
            } catch {}

            throw "Graph API fout op $Method $Uri (HTTP $statusCode): $($_.Exception.Message)`n$errBody"
        }
    }
}

# ─────────────────────────────────────────────
# GRAPH API: Mailmap-ID ophalen of aanmaken
# ─────────────────────────────────────────────
function Get-OrCreateFolder {
    param(
        [string]$Token,
        [string]$Mailbox,
        [string[]]$PathParts   # bijv. @('Inbox', 'Klanten', 'CompaNanny', 'Bachzaal')
    )

    # Start vanuit de root mailFolders
    $currentId   = $null
    $currentPath = ""

    for ($i = 0; $i -lt $PathParts.Count; $i++) {
        $part = $PathParts[$i]
        $currentPath += "/$part"

        if ($i -eq 0) {
            # Eerste niveau: wellKnownName of zoeken in root
            $uri = "$GRAPH_BASE/users/$Mailbox/mailFolders?`$top=100"
        } else {
            # Dieper niveau: zoek in childFolders van huidige map
            $uri = "$GRAPH_BASE/users/$Mailbox/mailFolders/$currentId/childFolders?`$top=100"
        }

        $folders = Invoke-GraphRequest -Method GET -Uri $uri -Token $Token
        $match   = $null

        if ($folders.value) {
            $match = $folders.value | Where-Object { $_.displayName -eq $part } | Select-Object -First 1
        }

        # Probeer wellKnownName voor Inbox
        if ($null -eq $match -and $i -eq 0 -and $part -eq 'Inbox') {
            $inboxUri = "$GRAPH_BASE/users/$Mailbox/mailFolders/inbox"
            try {
                $match = Invoke-GraphRequest -Method GET -Uri $inboxUri -Token $Token
            } catch { }
        }

        if ($null -eq $match) {
            # Map bestaat niet → aanmaken
            Write-Info "Map aanmaken: $currentPath"
            $newFolderBody = @{ displayName = $part }

            if ($i -eq 0) {
                $createUri = "$GRAPH_BASE/users/$Mailbox/mailFolders"
            } else {
                $createUri = "$GRAPH_BASE/users/$Mailbox/mailFolders/$currentId/childFolders"
            }

            $match = Invoke-GraphRequest -Method POST -Uri $createUri -JsonBody $newFolderBody -Token $Token
            Write-Ok "Map aangemaakt: $currentPath (ID: $($match.id))"
        }

        $currentId = $match.id
    }

    return $currentId
}

# ─────────────────────────────────────────────
# GRAPH API: Mails ophalen
# ─────────────────────────────────────────────
function Get-InboxMessages {
    param(
        [string]$Token,
        [string]$Mailbox
    )

    Write-Info "Inbox ophalen van $Mailbox..."

    # Haal berichten op uit Inbox (ongelezen én recente gelezen mails — laatste 3 dagen)
    $since = (Get-Date).AddDays(-3).ToString("yyyy-MM-ddTHH:mm:ssZ")
    $filter = "receivedDateTime ge $since"
    $select = "id,subject,sender,from,receivedDateTime,isRead,parentFolderId,bodyPreview"
    $uri    = "$GRAPH_BASE/users/$Mailbox/mailFolders/inbox/messages?" +
              "`$top=$MAX_MESSAGES&" +
              "`$filter=$([System.Uri]::EscapeDataString($filter))&" +
              "`$select=$select&" +
              "`$orderby=receivedDateTime desc"

    $result = Invoke-GraphRequest -Method GET -Uri $uri -Token $Token

    $messages = @()
    if ($result.value) { $messages += $result.value }

    Write-Ok "$($messages.Count) berichten gevonden in inbox"
    return $messages
}

# ─────────────────────────────────────────────
# MATCHING: Contactencache laden
# ─────────────────────────────────────────────
function Get-ContactsCache {
    param([string]$CachePath)

    if (-not (Test-Path $CachePath)) {
        Write-Warn "Contactencache niet gevonden op: $CachePath"
        Write-Warn "Voer -UpdateCache uit om de cache aan te maken."
        return @{ customers = @(); suppliers = @() }
    }

    try {
        $cache = Get-Content $CachePath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Ok "Contactencache geladen: $($cache.customers.Count) klanten, $($cache.suppliers.Count) leveranciers"
        return $cache
    } catch {
        throw "Kon contactencache niet inlezen: $_"
    }
}

# ─────────────────────────────────────────────
# MATCHING: CompaNanny vestiging bepalen
# ─────────────────────────────────────────────
function Get-CompaNannyVestiging {
    param(
        [string]$Subject,
        [string]$SenderAddress,
        [string]$SenderName
    )

    $searchText = "$Subject $SenderAddress $SenderName"

    foreach ($keyword in $COMPANANNY_KEYWORDS) {
        if ($searchText -imatch [regex]::Escape($keyword)) {
            return (Get-SafePathName $keyword)
        }
    }

    return "_Algemeen"
}

# ─────────────────────────────────────────────
# MATCHING: Bepaal target-map voor een bericht
# ─────────────────────────────────────────────
function Get-TargetFolder {
    param(
        [object]$Message,
        [object]$Cache
    )

    $senderEmail  = ""
    $senderDomain = ""
    $senderName   = ""

    # Haal afzenderinfo op (Graph geeft 'from' bij ontvangen mail)
    if ($Message.from -and $Message.from.emailAddress) {
        $senderEmail  = $Message.from.emailAddress.address.Trim().ToLower()
        $senderName   = $Message.from.emailAddress.name.Trim()
        if ($senderEmail -match '@(.+)$') {
            $senderDomain = $matches[1].ToLower()
        }
    } elseif ($Message.sender -and $Message.sender.emailAddress) {
        $senderEmail  = $Message.sender.emailAddress.address.Trim().ToLower()
        $senderName   = $Message.sender.emailAddress.name.Trim()
        if ($senderEmail -match '@(.+)$') {
            $senderDomain = $matches[1].ToLower()
        }
    }

    $subject = if ($Message.subject) { $Message.subject } else { "" }

    # ── Speciale regel: Moneybird notificaties ──────────────────────────────
    if ($senderEmail -eq 'noreply@moneybird.com') {
        # Probeer klantnaam uit onderwerp te halen
        # Onderwerp-patronen: "Factuur van Klant X", "Betaling ontvangen van Klant X", etc.
        $matchedContact = $null

        foreach ($contact in ($Cache.customers + $Cache.suppliers)) {
            $safeName = [regex]::Escape($contact.company_name)
            if ($subject -imatch $safeName) {
                $matchedContact = $contact
                break
            }
        }

        if ($null -ne $matchedContact) {
            $folderName = Get-SafePathName $matchedContact.company_name
            $type       = if ($matchedContact.type -eq 'supplier') { 'Leveranciers' } else { 'Klanten' }
            return @{
                Match       = $true
                Confidence  = 100
                MatchReason = "Moneybird noreply + klantnaam in onderwerp: $($matchedContact.company_name)"
                FolderParts = @('Inbox', $type, $folderName)
                ContactName = $matchedContact.company_name
            }
        }

        # Moneybird maar geen klant gevonden → twijfelgeval
        return @{
            Match       = $false
            Confidence  = 0
            MatchReason = "Moneybird noreply maar geen klantnaam herkend in onderwerp"
            FolderParts = @()
            ContactName = ""
        }
    }

    # ── Klantenlijst doorzoeken ─────────────────────────────────────────────
    foreach ($contact in $Cache.customers) {
        $contactDomain = ""
        $contactEmail  = if ($contact.email) { $contact.email.Trim().ToLower() } else { "" }

        if ($contactEmail -match '@(.+)$') {
            $contactDomain = $matches[1].ToLower()
        }

        $matchReason = ""
        $matched     = $false

        # Exacte e-mail match
        if (-not [string]::IsNullOrEmpty($senderEmail) -and -not [string]::IsNullOrEmpty($contactEmail) -and $senderEmail -eq $contactEmail) {
            $matchReason = "Exact e-mail match (klant): $senderEmail"
            $matched     = $true
        }
        # Exacte domein match
        elseif (-not [string]::IsNullOrEmpty($senderDomain) -and -not [string]::IsNullOrEmpty($contactDomain) -and $senderDomain -eq $contactDomain) {
            # Generieke domeinen uitsluiten
            $genericDomains = @('gmail.com','hotmail.com','outlook.com','yahoo.com','live.nl','live.com','icloud.com','ziggo.nl','kpnmail.nl','upcmail.nl','casema.nl','hetnet.nl','planet.nl','xs4all.nl','chello.nl','tele2.nl')
            if ($genericDomains -notcontains $senderDomain) {
                $matchReason = "Exact domein match (klant): $senderDomain"
                $matched     = $true
            }
        }

        if ($matched) {
            $companyName = $contact.company_name
            $folderName  = Get-SafePathName $companyName

            # CompaNanny-logica
            if ($companyName -imatch 'CompaNanny') {
                $vestiging   = Get-CompaNannyVestiging -Subject $subject -SenderAddress $senderEmail -SenderName $senderName
                return @{
                    Match       = $true
                    Confidence  = 100
                    MatchReason = "$matchReason → CompaNanny vestiging: $vestiging"
                    FolderParts = @('Inbox', 'Klanten', 'CompaNanny', $vestiging)
                    ContactName = $companyName
                }
            }

            return @{
                Match       = $true
                Confidence  = 100
                MatchReason = $matchReason
                FolderParts = @('Inbox', 'Klanten', $folderName)
                ContactName = $companyName
            }
        }
    }

    # ── Leverancierslijst doorzoeken ────────────────────────────────────────
    foreach ($contact in $Cache.suppliers) {
        $contactDomain = ""
        $contactEmail  = if ($contact.email) { $contact.email.Trim().ToLower() } else { "" }

        if ($contactEmail -match '@(.+)$') {
            $contactDomain = $matches[1].ToLower()
        }

        $matchReason = ""
        $matched     = $false

        if (-not [string]::IsNullOrEmpty($senderEmail) -and -not [string]::IsNullOrEmpty($contactEmail) -and $senderEmail -eq $contactEmail) {
            $matchReason = "Exact e-mail match (leverancier): $senderEmail"
            $matched     = $true
        }
        elseif (-not [string]::IsNullOrEmpty($senderDomain) -and -not [string]::IsNullOrEmpty($contactDomain) -and $senderDomain -eq $contactDomain) {
            $genericDomains = @('gmail.com','hotmail.com','outlook.com','yahoo.com','live.nl','live.com','icloud.com','ziggo.nl','kpnmail.nl','upcmail.nl','casema.nl','hetnet.nl','planet.nl','xs4all.nl','chello.nl','tele2.nl')
            if ($genericDomains -notcontains $senderDomain) {
                $matchReason = "Exact domein match (leverancier): $senderDomain"
                $matched     = $true
            }
        }

        if ($matched) {
            $folderName = Get-SafePathName $contact.company_name
            return @{
                Match       = $true
                Confidence  = 100
                MatchReason = $matchReason
                FolderParts = @('Inbox', 'Leveranciers', $folderName)
                ContactName = $contact.company_name
            }
        }
    }

    # Geen match
    return @{
        Match       = $false
        Confidence  = 0
        MatchReason = "Geen match gevonden voor afzender: $senderEmail ($senderDomain)"
        FolderParts = @()
        ContactName = ""
    }
}

# ─────────────────────────────────────────────
# LOGBOEK: Log-entry schrijven
# ─────────────────────────────────────────────
function Write-LogEntry {
    param(
        [string]$LogPath,
        [hashtable]$Entry
    )

    $log = @()

    if (Test-Path $LogPath) {
        try {
            $existing = Get-Content $LogPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing -is [array]) {
                $log = [System.Collections.ArrayList]$existing
            } elseif ($null -ne $existing) {
                $log = [System.Collections.ArrayList]@($existing)
            }
        } catch {
            Write-Warn "Kon bestaand logboek niet inlezen, begin opnieuw: $_"
            $log = [System.Collections.ArrayList]@()
        }
    }

    $null = $log.Add([PSCustomObject]$Entry)
    $log | ConvertTo-Json -Depth 5 | Set-Content $LogPath -Encoding UTF8
}

# ─────────────────────────────────────────────
# UNDO: Verplaatste mails terugzetten
# ─────────────────────────────────────────────
function Invoke-Undo {
    param(
        $Config,
        [string]$Token
    )

    $logPath = $Config.log_file

    if (-not (Test-Path $logPath)) {
        Write-Warn "Geen logboek gevonden op: $logPath"
        Write-Info "Er is niets om ongedaan te maken."
        return
    }

    $log = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $log -or ($log -is [array] -and $log.Count -eq 0)) {
        Write-Info "Logboek is leeg — niets om ongedaan te maken."
        return
    }

    if ($log -isnot [array]) { $log = @($log) }

    # Filter entries die nog niet zijn teruggedraaid
    $toUndo = $log | Where-Object { -not $_.undone }

    Write-Info "$($toUndo.Count) verplaatsingen ongedaan maken..."

    $undoneCount = 0
    $errorCount  = 0

    foreach ($entry in $toUndo) {
        try {
            Write-Info "Terugzetten: '$($entry.subject)' → $($entry.originalFolderId)"

            $moveBody = @{ destinationId = $entry.originalFolderId }
            $moveUri  = "$GRAPH_BASE/users/$($Config.shared_mailbox)/messages/$($entry.messageId)/move"
            $null     = Invoke-GraphRequest -Method POST -Uri $moveUri -JsonBody $moveBody -Token $Token

            # Markeer als teruggedraaid in log
            $entry | Add-Member -NotePropertyName 'undone' -NotePropertyValue $true -Force
            $entry | Add-Member -NotePropertyName 'undoneAt' -NotePropertyValue (Get-Date -Format 'o') -Force

            Write-Ok "Teruggezet: '$($entry.subject)'"
            $undoneCount++

        } catch {
            Write-Err "Kon '$($entry.subject)' niet terugzetten: $_"
            $errorCount++
        }
    }

    # Log bijwerken met undo-status
    $log | ConvertTo-Json -Depth 5 | Set-Content $logPath -Encoding UTF8

    Write-Host ""
    Write-Ok "Undo voltooid: $undoneCount teruggezet, $errorCount fouten"
}

# ─────────────────────────────────────────────
# MONEYBIRD: Cache bijwerken
# ─────────────────────────────────────────────
function Invoke-UpdateCache {
    param($Config)

    if ([string]::IsNullOrWhiteSpace($Config.moneybird_token)) {
        throw "moneybird_token ontbreekt in config.json"
    }
    if ([string]::IsNullOrWhiteSpace($Config.moneybird_admin_id)) {
        throw "moneybird_admin_id ontbreekt in config.json"
    }

    Write-Info "Moneybird contacten ophalen..."

    $headers = @{
        'Authorization' = "Bearer $($Config.moneybird_token)"
        'Content-Type'  = 'application/json'
    }

    # ── Klanten ophalen (contacts) ──────────────────────────────────────────
    $customers      = [System.Collections.ArrayList]@()
    $customerPage   = 1
    $customerTotal  = 0

    do {
        $uri = "$MONEYBIRD_BASE/$($Config.moneybird_admin_id)/contacts?page=$customerPage&per_page=100"
        try {
            $response = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
        } catch {
            throw "Moneybird API fout (klanten, pagina $customerPage): $_"
        }

        if ($null -eq $response -or $response.Count -eq 0) { break }

        foreach ($contact in $response) {
            $email = ""
            if ($contact.email) { $email = $contact.email.Trim().ToLower() }

            $null = $customers.Add([PSCustomObject]@{
                id           = $contact.id
                company_name = if ($contact.company_name) { $contact.company_name } else { "$($contact.firstname) $($contact.lastname)".Trim() }
                email        = $email
                type         = 'customer'
            })
        }

        $customerTotal += $response.Count
        $customerPage++

    } while ($response.Count -eq 100)

    Write-Ok "$($customers.Count) klanten opgehaald"

    # ── Leveranciers ophalen (purchase_invoices/suppliers zijn ook contacts in Moneybird)
    # Moneybird heeft geen apart leveranciers-endpoint; leveranciers zijn contacts met de
    # supplier-vlag. We halen ze op via de 'contacts' endpoint en filteren op 'supplier'.
    $suppliers     = [System.Collections.ArrayList]@()
    $supplierPage  = 1

    do {
        $uri = "$MONEYBIRD_BASE/$($Config.moneybird_admin_id)/contacts?page=$supplierPage&per_page=100&supplier=true"
        try {
            $response = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
        } catch {
            # Moneybird geeft 422 als filter niet bestaat — dan stoppen we
            Write-Warn "Leveranciers-filter niet beschikbaar, leveranciers worden overgeslagen: $_"
            break
        }

        if ($null -eq $response -or $response.Count -eq 0) { break }

        foreach ($contact in $response) {
            $email = ""
            if ($contact.email) { $email = $contact.email.Trim().ToLower() }

            $null = $suppliers.Add([PSCustomObject]@{
                id           = $contact.id
                company_name = if ($contact.company_name) { $contact.company_name } else { "$($contact.firstname) $($contact.lastname)".Trim() }
                email        = $email
                type         = 'supplier'
            })
        }

        $supplierPage++

    } while ($response.Count -eq 100)

    Write-Ok "$($suppliers.Count) leveranciers opgehaald"

    # ── Cache wegschrijven ──────────────────────────────────────────────────
    $cacheDir = Split-Path -Parent $Config.contacts_cache
    if (-not (Test-Path $cacheDir)) {
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    }

    $cache = [PSCustomObject]@{
        updated_at = (Get-Date -Format 'o')
        customers  = $customers
        suppliers  = $suppliers
    }

    $cache | ConvertTo-Json -Depth 5 | Set-Content $Config.contacts_cache -Encoding UTF8
    Write-Ok "Cache weggeschreven naar: $($Config.contacts_cache)"
    Write-Ok "Totaal: $($customers.Count) klanten + $($suppliers.Count) leveranciers"
}

# ─────────────────────────────────────────────
# HOOFD: E-mails sorteren
# ─────────────────────────────────────────────
function Invoke-SortInbox {
    param(
        $Config,
        [string]$Token,
        [bool]$IsDryRun
    )

    $mailbox = $Config.shared_mailbox
    $logPath = $Config.log_file

    # Zorg dat log-map bestaat
    $logDir = Split-Path -Parent $logPath
    if (-not [string]::IsNullOrEmpty($logDir) -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    # Contactencache laden
    $cache = Get-ContactsCache -CachePath $Config.contacts_cache

    # Mails ophalen
    $messages = Get-InboxMessages -Token $Token -Mailbox $mailbox

    if ($messages.Count -eq 0) {
        Write-Info "Geen berichten gevonden om te sorteren."
        return
    }

    $moved    = 0
    $skipped  = 0
    $errors   = 0

    # Folder-ID cache om dubbele API-calls te vermijden
    $folderCache = @{}

    foreach ($msg in $messages) {
        $subject      = if ($msg.subject) { $msg.subject } else { "(geen onderwerp)" }
        $senderEmail  = if ($msg.from -and $msg.from.emailAddress) { $msg.from.emailAddress.address } else { "onbekend" }

        Write-Host ""
        Write-Info "Verwerken: '$subject' van $senderEmail"

        try {
            $result = Get-TargetFolder -Message $msg -Cache $cache

            if (-not $result.Match) {
                Write-Skip "Twijfelgeval — niet verplaatst. Reden: $($result.MatchReason)"
                $skipped++
                continue
            }

            # Target-map opbouwen
            $folderKey = $result.FolderParts -join '/'

            if (-not $folderCache.ContainsKey($folderKey)) {
                if ($IsDryRun) {
                    # In dry-run simuleren we de folder-ID
                    $folderCache[$folderKey] = "DRYRUN-$folderKey"
                } else {
                    $folderId = Get-OrCreateFolder -Token $Token -Mailbox $mailbox -PathParts $result.FolderParts
                    $folderCache[$folderKey] = $folderId
                }
            }

            $targetFolderId = $folderCache[$folderKey]

            if ($IsDryRun) {
                Write-Dry "ZOU verplaatsen naar: $folderKey"
                Write-Dry "Reden: $($result.MatchReason)"
                $moved++
                continue
            }

            # Log VOOR verplaatsing
            $logEntry = @{
                messageId      = $msg.id
                subject        = $subject
                sender         = $senderEmail
                originalFolder = 'Inbox'
                originalFolderId = $msg.parentFolderId
                targetFolder   = $folderKey
                targetFolderId = $targetFolderId
                matchReason    = $result.MatchReason
                contactName    = $result.ContactName
                movedAt        = (Get-Date -Format 'o')
                undone         = $false
            }
            Write-LogEntry -LogPath $logPath -Entry $logEntry

            # Mail verplaatsen
            $moveBody = @{ destinationId = $targetFolderId }
            $moveUri  = "$GRAPH_BASE/users/$mailbox/messages/$($msg.id)/move"
            $null     = Invoke-GraphRequest -Method POST -Uri $moveUri -JsonBody $moveBody -Token $Token

            Write-Ok "Verplaatst naar: $folderKey"
            Write-Ok "Reden: $($result.MatchReason)"
            $moved++

        } catch {
            Write-Err "Fout bij verwerken van '$subject': $_"
            $errors++
        }
    }

    Write-Host ""
    Write-Host "────────────────────────────────────────────" -ForegroundColor Cyan
    if ($IsDryRun) {
        Write-Dry "DRY RUN samenvatting: $moved zou worden verplaatst, $skipped twijfelgevallen, $errors fouten"
    } else {
        Write-Ok  "Klaar: $moved verplaatst, $skipped twijfelgevallen, $errors fouten"
        if ($moved -gt 0) {
            Write-Info "Logboek bijgewerkt: $logPath"
            Write-Info "Gebruik -Undo om alles terug te zetten"
        }
    }
    Write-Host "────────────────────────────────────────────" -ForegroundColor Cyan
}

# ─────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────
try {
    Write-Banner

    # Config laden
    $config = Get-Config -Path $ConfigPath

    Write-Info "Mailbox  : $($config.shared_mailbox)"
    Write-Info "Cache    : $($config.contacts_cache)"
    Write-Info "Logboek  : $($config.log_file)"
    if ($DryRun) { Write-Dry "DRY RUN modus actief — er wordt niets verplaatst" }

    # ── UpdateCache modus ───────────────────────────────────────────────────
    if ($UpdateCache) {
        Write-Info "Moneybird-cache bijwerken..."
        Invoke-UpdateCache -Config $config
        Write-Ok "Cache bijgewerkt. Klaar!"
        exit 0
    }

    # ── Graph token ophalen (voor Sort en Undo) ─────────────────────────────
    $token = Get-GraphToken -Config $config

    # ── Undo modus ──────────────────────────────────────────────────────────
    if ($Undo) {
        Invoke-Undo -Config $config -Token $token
        exit 0
    }

    # ── Sorteermodus (default) ──────────────────────────────────────────────
    Invoke-SortInbox -Config $config -Token $token -IsDryRun $DryRun.IsPresent

    exit 0

} catch {
    Write-Host ""
    Write-Err "Kritieke fout: $_"
    Write-Err "Regel: $($_.InvocationInfo.ScriptLineNumber)"
    if ($_.Exception.StackTrace) {
        Write-Host $_.Exception.StackTrace -ForegroundColor DarkGray
    }
    exit 1
}
