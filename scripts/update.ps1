# Повторный деплой Backlink Atlas.
#
# Для всех запусков после первого. Регистрации и установки здесь нет
# намеренно: forge register, запущенный второй раз, отвязывает приложение
# от окружений и хранилища, а установка уже сделана.
#
# Запускается двойным кликом по ОБНОВИТЬ.cmd в корне проекта.

Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

Заголовок 'BACKLINK ATLAS - ОБНОВЛЕНИЕ'
Write-Host '   Соберёт новую версию кода и отправит её в Confluence.'
Write-Host '   Приложение уже установлено, ставить заново не нужно.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы начать'

# ------------------------------------------------------------------ 1
Заголовок 'Вход' 1 5
Прочитать-Токен

# ------------------------------------------------------------------ 2
Заголовок 'Свои проверки' 2 5
Write-Host '   105 тестов и аудит безопасности - до того, как что-то'
Write-Host '   уедет в Confluence.'
Write-Host ''
& npm test
if ($LASTEXITCODE -ne 0) { Стоп 'тесты (npm test)' }
& npm run audit
if ($LASTEXITCODE -ne 0) { Стоп 'аудит безопасности (npm run audit)' }

# ------------------------------------------------------------------ 3
Заголовок 'Проверка кода Atlassian' 3 5
& forge lint
if ($LASTEXITCODE -ne 0) { Стоп 'проверка кода (forge lint)' }

# ------------------------------------------------------------------ 4
Заголовок 'Сборка и отправка   (1-2 минуты)' 4 5
& forge deploy
if ($LASTEXITCODE -ne 0) { Стоп 'сборка (forge deploy)' }

# ------------------------------------------------------------------ 5
Заголовок 'Обновление установки' 5 5
Write-Host '   forge deploy кладёт новый код, но установка в Confluence'
Write-Host '   может остаться на прежней версии. Это её и двигает.'
Write-Host ''
& forge install --upgrade --site $env:FORGE_SITE --product Confluence --confirm-scopes
if ($LASTEXITCODE -ne 0) { Стоп 'обновление установки (forge install --upgrade)' }

Write-Host ''
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host '   ГОТОВО' -ForegroundColor Green
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host ''
Write-Host '   Новая версия в Confluence. Обновите страницу приложения'
Write-Host '   в браузере - Ctrl+F5.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы закрыть'
