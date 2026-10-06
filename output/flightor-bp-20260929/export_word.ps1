$ErrorActionPreference = 'Stop'
$bpDocxPath = [IO.Path]::Combine($PSScriptRoot, 'FlightOR_商业计划书_终稿.docx')
$bpPdfPath = [IO.Path]::Combine($PSScriptRoot, 'FlightOR_商业计划书_终稿.pdf')
$bpWordApp = New-Object -ComObject Word.Application
$bpWordDoc = $null
try {
    $bpWordApp.Visible = $false
    $bpWordApp.DisplayAlerts = 0
    $bpWordApp.Options.SaveInterval = 0
    $bpWordDoc = $bpWordApp.Documents.Open($bpDocxPath, $false, $false)
    $bpWordDoc.Fields.Update() | Out-Null
    foreach ($bpSection in $bpWordDoc.Sections) {
        foreach ($bpFooter in $bpSection.Footers) {
            $bpFooter.Range.Fields.Update() | Out-Null
        }
    }
    $bpWordDoc.Repaginate()
    Write-Output ('Pages: ' + $bpWordDoc.ComputeStatistics(2))
    $bpWordDoc.Save()
    $bpWordDoc.ExportAsFixedFormat($bpPdfPath, 17, $false, 0, 0, 1, 9999, 0, $true, $true, 1)
    $bpWordDoc.Close(0)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($bpWordDoc)
    $bpWordDoc = $null
    Get-Item -LiteralPath $bpDocxPath, $bpPdfPath | Select-Object Name, Length
} finally {
    if ($null -ne $bpWordDoc) {
        $bpWordDoc.Close(0)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($bpWordDoc)
    }
    $bpWordApp.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($bpWordApp)
}
