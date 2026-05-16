# Night Agent Setup — Mortise & Tenon
# Voer uit via: powershell -ExecutionPolicy Bypass -File setup_task.ps1
#
# Draait elk uur, 24/7. De agent zelf checkt of Ollama bezet is
# en slaat de run stil over als dat zo is.

$AgentsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentScript = Join-Path $AgentsDir "nachtelijke_agent.py"
$AgentLog = Join-Path $AgentsDir "agent_log.txt"
$TaskName = "MT_Agent"

Write-Host "Agents map: $AgentsDir"

# Verwijder alle oude tasks
foreach ($old in @("MT_Agent", "MT_NightAgent", "MT_DayAgent", "MortiseTenon_NachtAgent")) {
    $existing = Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $old -Confirm:$false
        Write-Host "Oude task verwijderd: $old"
    }
}

# Gebruik PowerShell ipv cmd.exe — geen & probleem, UTF-8 werkt correct
$psArgs = "-NoProfile -ExecutionPolicy Bypass -Command " +
    "`$env:PYTHONUTF8='1'; " +
    "`$env:PYTHONIOENCODING='utf-8'; " +
    "cd '$AgentsDir'; " +
    "python '$AgentScript' fase1 *>> '$AgentLog'; " +
    "python '$AgentScript' fase2 *>> '$AgentLog'; " +
    "python '$AgentScript' fase3 *>> '$AgentLog'; " +
    "python '$AgentScript' fase4 *>> '$AgentLog'; " +
    "python '$AgentScript' fase5 *>> '$AgentLog'"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $psArgs

# Elk uur, elke dag — agent regelt zelf of hij iets doet
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) `
    -Once -At "00:00"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Force | Out-Null

Write-Host ""
Write-Host "============================================"
Write-Host " MT_Agent ingepland: elk uur, 24/7"
Write-Host " Ollama bezet? -> run wordt overgeslagen"
Write-Host " Log: $AgentLog"
Write-Host "============================================"
Write-Host ""

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Status: $($task.State)"
    Write-Host "Volgende run: $($info.NextRunTime)"
} else {
    Write-Host "FOUT: Task niet gevonden!"
}

Read-Host "Druk Enter om af te sluiten"
