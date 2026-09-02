# Выпуск в production.
#
# Отдельно от ОБНОВИТЬ.cmd намеренно. Тот кладёт код в development, где его
# видите только вы. Этот выпускает версию, которую увидят покупатели, и
# без которой Marketplace не примет заявку.
#
# Запускается двойным кликом по ПРОДАКШЕН.cmd в корне проекта.

Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

Заголовок 'BACKLINK ATLAS - ВЫПУСК В PRODUCTION'
Write-Host '   development - это ваша песочница. production - то, что'
Write-Host '   получат покупатели, и то, что требует Marketplace.'
Write-Host ''
Write-Host '   Сначала прогоняются все проверки. Если хоть одна не'
Write-Host '   пройдёт, ничего никуда не уедет.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы начать'

Заголовок 'Вход' 1 4
Прочитать-Токен

Заголовок 'Свои проверки' 2 4
& npm test
if ($LASTEXITCODE -ne 0) { Стоп 'тесты (npm test)' }
& npm run audit
if ($LASTEXITCODE -ne 0) { Стоп 'аудит безопасности (npm run audit)' }

Заголовок 'Проверка кода Atlassian' 3 4
& forge lint -e production
if ($LASTEXITCODE -ne 0) { Стоп 'проверка кода (forge lint)' }

Заголовок 'Сборка и выпуск   (1-2 минуты)' 4 4
& forge deploy -e production
if ($LASTEXITCODE -ne 0) { Стоп 'выпуск (forge deploy -e production)' }

Write-Host ''
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host '   ВЫПУЩЕНО В PRODUCTION' -ForegroundColor Green
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host ''
Write-Host '   В консоли разработчика строка "Last deployed to production"'
Write-Host '   должна перестать говорить "App not yet deployed".'
Write-Host ''
Write-Host '   Это был последний технический шаг. Дальше - листинг.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы закрыть'
