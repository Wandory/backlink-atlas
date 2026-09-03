# Только регистрация приложения — один шаг, ничего больше.
#
# Существует отдельно от ЗАПУСК.cmd по одной причине: на этом шаге Atlassian
# показывает соглашение (Developer Terms, Privacy Policy и согласие оплачивать
# превышение бесплатного лимита Forge). Согласия за владельца аккаунта не
# подписываются, поэтому именно этот шаг делается руками, а всё остальное —
# сборка, деплой, установка — уже нет.
#
# Запускается двойным кликом по РЕГИСТРАЦИЯ.cmd в корне проекта.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Set-Location (Split-Path -Parent $PSScriptRoot)

. "$PSScriptRoot\common.ps1"

# Developer Space уже существует с прошлого приложения. Передаём его явно,
# иначе CLI пытается спросить и падает там, где спросить некого.
$ПРОСТРАНСТВО = '01ef9239-79ee-4e45-9907-f58d4b235d37'

Заголовок 'BACKLINK ATLAS - РЕГИСТРАЦИЯ'
Write-Host '   Один шаг. Дальше всё сделает Клод.'
Write-Host ''
Write-Host '   Atlassian покажет соглашение. Нужно:'
Write-Host ''
Write-Host '      1. нажать ПРОБЕЛ - поставить галочку'
Write-Host '      2. нажать ENTER  - подтвердить'
Write-Host ''
Write-Host '   Это Developer Terms, Privacy Policy и согласие'
Write-Host '   оплачивать превышение бесплатного лимита Forge.'
Write-Host '   Прочитайте, если хотите - ссылки будут на экране.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы начать'

Прочитать-Токен

$манифест = Get-Content 'manifest.yml' -Raw
if ($манифест -notmatch 'app/00000000-0000-0000-0000-000000000000') {
    $id = [regex]::Match($манифест, 'app/([0-9a-f-]{36})').Groups[1].Value
    Write-Host ''
    Write-Host '   Приложение уже зарегистрировано.' -ForegroundColor Green
    Write-Host "   id: $id"
    Write-Host ''
    Read-Host '   Нажмите Enter, чтобы закрыть'
    exit 0
}

Write-Host ''
& forge register 'Backlink Atlas' -s $ПРОСТРАНСТВО
if ($LASTEXITCODE -ne 0) { Стоп 'регистрация приложения (forge register)' }

# Проверяем результат сами, а не верим коду возврата: манифест должен был
# перестать быть заглушкой.
$манифест = Get-Content 'manifest.yml' -Raw
$id = [regex]::Match($манифест, 'app/([0-9a-f-]{36})').Groups[1].Value

Write-Host ''
Write-Host ('=' * 59) -ForegroundColor Green
if ($id -and $id -ne '00000000-0000-0000-0000-000000000000') {
    Write-Host '   ГОТОВО' -ForegroundColor Green
    Write-Host ('=' * 59) -ForegroundColor Green
    Write-Host ''
    Write-Host "   id приложения: $id"
    Write-Host ''
    Write-Host '   Напишите в чат "готово" - дальше Клод'
    Write-Host '   соберёт, задеплоит и установит сам.'
} else {
    Write-Host '   НЕ ПОЛУЧИЛОСЬ' -ForegroundColor Red
    Write-Host ('=' * 59) -ForegroundColor Red
    Write-Host ''
    Write-Host '   В манифесте всё ещё заглушка.'
    Write-Host '   Сфотографируйте это окно и пришлите в чат.'
}
Write-Host ''
Read-Host '   Нажмите Enter, чтобы закрыть'
