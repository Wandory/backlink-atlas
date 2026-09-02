# Запуск Backlink Atlas.
#
# Пять шагов подряд, от входа в Atlassian до установки приложения на сайт.
# Вводить нужно только токен на первом шаге.
#
# Запускается двойным кликом по ЗАПУСК.cmd в корне проекта.

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'

Set-Location (Split-Path -Parent $PSScriptRoot)


. "$PSScriptRoot\common.ps1"

Заголовок 'BACKLINK ATLAS - ЗАПУСК'
Write-Host '   Пять шагов подряд. Вводить нужно только токен'
Write-Host '   на первом шаге, дальше всё само.'
Write-Host ''
Write-Host '   Окно само не закроется. Если что-то пойдёт не так -'
Write-Host '   сфотографируйте его и пришлите в чат.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы начать'

# ------------------------------------------------------------------ 1
Заголовок -Номер 1 -Всего 5 -Текст 'Вход в Atlassian'

Прочитать-Токен

# ------------------------------------------------------------------ 2
Заголовок -Номер 2 -Всего 5 -Текст 'Регистрация приложения'
Write-Host '   Если спросит про Developer Space - выберите стрелками'
Write-Host '   первый вариант и нажмите Enter.'
Write-Host '   Если спросит про условия - согласитесь.'
Write-Host ''

# Регистрировать можно ровно один раз: повторный forge register заводит
# ВТОРОЕ приложение и переписывает id в манифесте, отвязывая от хранилища.
# Именно это и случилось здесь: первый запуск упал на сборке уже после
# регистрации, второй запустил её снова, и в консоли осталось два
# приложения-близнеца. Скрипт, который можно перезапустить после ошибки,
# обязан это учитывать.
$манифест = Get-Content 'manifest.yml' -Raw
if ($манифест -match 'id:\s*ari:cloud:ecosystem::app/00000000-0000-0000-0000-000000000000') {
    & forge register 'Backlink Atlas'
    if ($LASTEXITCODE -ne 0) { Стоп 'регистрация приложения (forge register)' }
} else {
    $id = [regex]::Match($манифест, 'app/([0-9a-f-]{36})').Groups[1].Value
    Write-Host '   Приложение уже зарегистрировано, пропускаю.' -ForegroundColor Green
    Write-Host "   id: $id"
    Write-Host ''
}

Write-Host ''
Write-Host '   Проверяю, что регистрация прошла...' -ForegroundColor DarkGray
& npm run audit
Write-Host ''
Write-Host '   Строчки "manifest.placeholder-id" выше быть не должно.'
Write-Host ''
Read-Host '   Enter - дальше'

# ------------------------------------------------------------------ 3
Заголовок -Номер 3 -Всего 5 -Текст 'Проверка кода'
& forge lint
if ($LASTEXITCODE -ne 0) { Стоп 'проверка кода (forge lint)' }

# ------------------------------------------------------------------ 4
Заголовок -Номер 4 -Всего 5 -Текст 'Сборка и отправка   (1-2 минуты)'
& forge deploy
if ($LASTEXITCODE -ne 0) { Стоп 'сборка (forge deploy)' }

# ------------------------------------------------------------------ 5
Заголовок -Номер 5 -Всего 5 -Текст 'Установка на ваш Confluence'
Write-Host '   Попросит подтвердить права. Их три, и ни одно не позволяет писать в Confluence:'
Write-Host ''
Write-Host '      read:page:confluence   - читать текст страниц, чтобы найти в нём ссылки'
Write-Host '      read:space:confluence  - ключи пространств, чтобы назвать их в отчёте'
Write-Host '      storage:app            - хранить сам индекс'
Write-Host ''
Write-Host '   Нажмите Y и Enter.'
Write-Host ''

& forge install --product Confluence --site $env:FORGE_SITE
if ($LASTEXITCODE -ne 0) { Стоп 'установка на сайт (forge install)' }

# ------------------------------------------------------------------ готово
Write-Host ''
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host '   ГОТОВО' -ForegroundColor Green
Write-Host ('=' * 59) -ForegroundColor Green
Write-Host ''
Write-Host "   Приложение стоит на $SITE"
Write-Host ''
Write-Host '   Дальше в Confluence:'
Write-Host '      шестерёнка справа вверху  ->  Приложения  ->  Backlink Atlas'
Write-Host ''
Write-Host '   Напишите в чат, что всё прошло, и продолжим.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы закрыть'
