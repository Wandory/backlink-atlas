# Общее для ЗАПУСК.cmd и ОБНОВИТЬ.cmd.
#
# Подключается через  . "$PSScriptRoot\common.ps1"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Заголовок {
    param($Текст, $Номер, $Всего)
    Write-Host ''
    Write-Host ('=' * 59) -ForegroundColor DarkCyan
    if ($Номер) {
        Write-Host ("   ШАГ $Номер из $Всего   $Текст") -ForegroundColor Cyan
    } else {
        Write-Host ("   $Текст") -ForegroundColor Cyan
    }
    Write-Host ('=' * 59) -ForegroundColor DarkCyan
    Write-Host ''
}

function Стоп {
    param($Что)
    Write-Host ''
    Write-Host ('=' * 59) -ForegroundColor Red
    Write-Host '   ОСТАНОВИЛОСЬ НА ОШИБКЕ' -ForegroundColor Red
    Write-Host ('=' * 59) -ForegroundColor Red
    Write-Host ''
    Write-Host "   Не прошло: $Что"
    Write-Host ''
    Write-Host '   Ничего не сломалось. Сфотографируйте это окно'
    Write-Host '   целиком и пришлите в чат - разберёмся.'
    Write-Host ''
    Read-Host '   Нажмите Enter, чтобы закрыть'
    exit 1
}

<#
Читает ТОКЕН.txt и выставляет FORGE_EMAIL / FORGE_API_TOKEN.

Токен живёт в файле, а не вводится в консоли: пароль, набранный вслепую в
чёрном окне - лишний способ всё уронить на опечатке, и именно это здесь
однажды и произошло.
#>
function Прочитать-Токен {
    $файл = Join-Path (Get-Location) 'ТОКЕН.txt'
    if (-not (Test-Path $файл)) {
        Стоп 'рядом нет файла ТОКЕН.txt - он должен лежать в папке backlink-atlas'
    }

    $значения = @{}
    foreach ($строка in [System.IO.File]::ReadAllLines($файл, [System.Text.Encoding]::UTF8)) {
        $чистая = $строка.Trim([char]0xFEFF, ' ', "`t")
        if ($чистая -match '^(FORGE_[A-Z_]+)=(.*)$') {
            # По первому "=", а не по каждому: токены сами содержат "=".
            $значения[$Matches[1]] = $Matches[2].Trim()
        }
    }

    $почта = $значения['FORGE_EMAIL']
    $токен = $значения['FORGE_API_TOKEN']

    if (-not $токен -or $токен -eq 'СЮДА') {
        Write-Host '   В файле ТОКЕН.txt токен ещё не вписан.' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '   Откройте ТОКЕН.txt, замените слово СЮДА на токен,'
        Write-Host '   сохраните (Ctrl+S) и запустите этот файл заново.'
        Write-Host ''
        Стоп 'токен не вписан в ТОКЕН.txt'
    }

    $env:FORGE_EMAIL = $почта
    $env:FORGE_API_TOKEN = $токен
    # Адрес сайта тоже живёт в ТОКЕН.txt, а не в коде: этот репозиторий
    # публичный, и ничьей почты или чужого адреса в нём быть не должно.
    if (-not $значения['FORGE_SITE']) {
        Стоп 'в ТОКЕН.txt не вписана строка FORGE_SITE=ваш-сайт.atlassian.net'
    }
    $env:FORGE_SITE = $значения['FORGE_SITE']

    Write-Host "   Почта:  $почта"
    Write-Host ('   Токен:  прочитан из ТОКЕН.txt, длина ' + $токен.Length + ' символов')
    Write-Host ''

    & forge whoami
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '   Atlassian не принял этот токен.' -ForegroundColor Red
        Write-Host ''
        Write-Host '   Самая частая причина: токен создан обычной кнопкой'
        Write-Host '   "Create API token". Нужна соседняя -'
        Write-Host '   "Create API token WITH SCOPES", и в ней App = Forge.'
        Write-Host ''
        Write-Host '   https://id.atlassian.com/manage-profile/security/api-tokens'
        Write-Host ''
        Стоп 'токен не подошёл'
    }
    Write-Host '   Вход прошёл.' -ForegroundColor Green
}
