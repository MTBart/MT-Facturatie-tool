# Check nachtelijke agent scheduled task
$output = @()
$output += "=== SCHEDULED TASK CHECK ==="
$output += (Get-Date).ToString()
$output += ""

try {
    $task = Get-ScheduledTask -TaskName "MortiseTenon_NachtAgent" -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName "MortiseTenon_NachtAgent"
    $output += "Status: $($task.State)"
    $output += "Last Run: $($info.LastRunTime)"
    $output += "Last Result: $($info.LastTaskResult)"
    $output += "Next Run: $($info.NextRunTime)"
    $output += ""
    $output += "=== TASK DETAILS ==="
    $output += "Triggers: $($task.Triggers | Out-String)"
    $output += "Actions: $($task.Actions | Out-String)"
} catch {
    $output += "FOUT: Task niet gevonden — $_"
    $output += ""
    $output += "=== ALLE TAKEN MET 'MORTISE' OF 'NACHT' ==="
    $found = Get-ScheduledTask | Where-Object { $_.TaskName -match "Mortise|Nacht|Agent" }
    if ($found) {
        $found | ForEach-Object { $output += "  - $($_.TaskName): $($_.State)" }
    } else {
        $output += "  Geen taken gevonden met die namen."
        $output += ""
        $output += "=== ALLE CUSTOM TAKEN (niet-Microsoft) ==="
        Get-ScheduledTask | Where-Object { $_.TaskPath -eq "\" } | ForEach-Object {
            $output += "  - $($_.TaskName): $($_.State)"
        }
    }
}

$output += ""
$output += "=== PYTHON CHECK ==="
try {
    $py = & python --version 2>&1
    $output += "Python: $py"
    $pyPath = (Get-Command python -ErrorAction SilentlyContinue).Source
    $output += "Path: $pyPath"
} catch {
    $output += "Python niet gevonden op PATH"
}

$output += ""
$output += "=== AGENTS MAP ==="
$agentsPath = "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude\Agents"
if (Test-Path $agentsPath) {
    Get-ChildItem $agentsPath | ForEach-Object {
        $output += "  $($_.Name) - $($_.LastWriteTime)"
    }
} else {
    $output += "Agents map niet gevonden op: $agentsPath"
}

$output | Out-File -FilePath "$agentsPath\task_check_output.txt" -Encoding UTF8
Write-Host "Done"
