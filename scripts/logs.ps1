# Логи приложения из Confluence.
#
# Показывает, что происходило внутри Forge: ошибки функций, исключения,
# всё, что приложение писало в console. Единственный способ увидеть,
# почему страница не рисуется.
#
# Запускается двойным кликом по ЛОГИ.cmd в корне проекта.

Set-Location (Split-Path -Parent $PSScriptRoot)
. "$PSScriptRoot\common.ps1"

Заголовок 'BACKLINK ATLAS - ЛОГИ'
Write-Host '   Покажет, что происходило внутри приложения за последнее'
Write-Host '   время: ошибки, исключения, сообщения.'
Write-Host ''
Write-Host '   Сфотографируйте вывод целиком и пришлите в чат.'
Write-Host ''
Read-Host '   Нажмите Enter'

Прочитать-Токен

Заголовок 'Последние записи'
& forge logs -n 60 -s 45m -g
if ($LASTEXITCODE -ne 0) { Стоп 'чтение логов (forge logs)' }

Write-Host ''
Write-Host '   Если тут пусто - откройте страницу приложения в Confluence,'
Write-Host '   подождите полминуты и запустите этот файл ещё раз.'
Write-Host ''
Read-Host '   Нажмите Enter, чтобы закрыть'
