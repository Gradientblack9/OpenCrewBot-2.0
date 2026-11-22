param(
    [ValidateRange(1, 65535)]
    [int]$Port = 11435
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root 'data/local-model'
$runtime = Get-ChildItem -LiteralPath (Join-Path $data 'llama') -Filter 'llama-server.exe' -Recurse -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
$weights = Join-Path $data 'qwen3-1.7b-q8_0.gguf'

if (!$runtime -or !(Test-Path -LiteralPath $weights -PathType Leaf)) {
    throw 'The workspace llama.cpp executable or Qwen model file is missing. See Local agent chat in the README.'
}

& $runtime.FullName --host 127.0.0.1 --port $Port --cors-origins localhost --no-ui --model $weights --alias qwen3-1.7b --ctx-size 8192 --parallel 1 --threads 6 --n-gpu-layers 0 --jinja --reasoning off
exit $LASTEXITCODE
