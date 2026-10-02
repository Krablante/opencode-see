# Настройка

[English](./configuration.md) · [Русский](./configuration.ru.md) · [Главная](../README.ru.md)

## Где лежат параметры

Плагин читает один JSON-файл при каждом вызове инструмента. Если файла нет,
используются начальные значения. Ошибка JSON или неверный тип объекта настроек
вызывают явную ошибку. Окружение имеет приоритет над файлом. Параметры плагина
меняются без перезапуска хоста; изменение списка плагинов требует перезапуска.

Путь выбирается в следующем порядке. Это альтернативы, а не объединяемые файлы:

1. `OPENCODE_SEE_CONFIG`, с раскрытием `~/`.
2. `$OPENCODE_CONFIG_DIR/opencode-see.json`.
3. В Windows при наличии `APPDATA`: `%APPDATA%/opencode/opencode-see.json`.
4. Иначе: `$XDG_CONFIG_HOME/opencode/opencode-see.json` либо
   `~/.config/opencode/opencode-see.json`, если XDG не задан.

Для OpenCodez задай `OPENCODE_CONFIG_DIR` с его каталогом конфигурации либо
прямой путь в `OPENCODE_SEE_CONFIG`, если это ещё не делает запускной скрипт.
Относительный прямой путь считается от рабочего каталога процесса хоста.

## Параметры

[examples/opencode-see.json](../examples/opencode-see.json) содержит переносимые
начальные значения. Указывай только то, что хочешь изменить. Для автоматического
поиска браузера не задавай `chromiumPath`.

| Поле | Начальное значение | Значение |
| --- | --- | --- |
| `screenshotDirectory` | `.opencode/screenshots` | От активного проекта; абсолютные пути и `~/` тоже работают |
| `chromiumPath` | автоматически | Путь к исполняемому файлу либо команда на PATH; ошибочный прямой выбор не заменяется другим браузером |
| `viewport.width`, `viewport.height` | `1440`, `900` | Размеры по умолчанию; аргументы инструмента важнее |
| `virtualTimeBudgetMs` | `2000` | Реальное ожидание после загрузки в CDP; бюджет виртуального времени в CLI |
| `screenshotTimeoutMs` | `30000` | Общий срок для CDP и возможного перехода на CLI |
| `visionDelegate.enabled` | `true` | Разрешить делегирование |
| `visionDelegate.model` | `opencode-go/gpt-5.6-luna` | Точная ссылка `provider/model` |
| `visionDelegate.forceFor` | `[]` | Активные модели, которым обязательно нужен делегат |
| `visionDelegate.prompt` | `Опиши содержимое каждой приложенной картинки подробно и по делу.` | Базовый запрос; аргумент `question` дополняет его |
| `visionDelegate.timeoutMs` | `90000` | Общий бюджет создания сессии и получения ответа |
| `visionDelegate.deleteAfter` | `true` | Удалить сессию делегата после завершения или ошибки |

Размеры и интервалы должны быть положительными целыми числами не больше
2 147 483 647. Для окна действует отдельный предел в 32 мегапикселя. Увеличение
таймаута не расширяет ограничения на размер файла или окна.

## Выбрать маршрут к vision-модели

Модель с объявленной поддержкой изображений получает их напрямую. Текстовая
модель автоматически обращается к делегату. `forceFor` направляет через него
также перечисленные нативные модели. Совпадение точное, без шаблонов.

```json
{
  "visionDelegate": {
    "model": "your-provider/your-vision-model",
    "forceFor": ["your-provider/your-caller-model"]
  }
}
```

Бери ID модели из `opencode models` либо `opencodez models`. Принимается любой
провайдер, зарегистрированный в этом хосте. Первая `/` разделяет провайдера и
модель; остальные входят в ID модели. Сначала авторизуй провайдера в OpenCode
и выбери модель, принимающую картинки. Плагин не подменяет выбор другой моделью.
Для начальной Go-модели нужен доступ к её провайдеру; бесплатного резервного
маршрута здесь нет.

`forceFor` влияет на результаты `image_view` и `screenshot`, но не переписывает
вложения в сообщениях пользователя. Текстовым моделям добавляется системная
подсказка вызвать `image_view` для картинки из чата; нативным — нет. При
выключенном делегировании модель, которой оно нужно, получает объяснение без
бинарного вложения.

У сессии делегата отключены инструменты. Отмена или таймаут также вызывают
остановку сессии на сервере, даже при `deleteAfter: false`. Запросы очистки
ограничены отдельно и могут добавить время после таймаута ответа. Сохранённые
сессии содержат картинки и занимают место в хранилище хоста. Удаляй их, когда
они больше не нужны. Ошибки очистки попадают в журнал хоста.

## Переменные окружения

| Переменная | Поле |
| --- | --- |
| `OPENCODE_SEE_SCREENSHOT_DIRECTORY` | `screenshotDirectory` |
| `OPENCODE_SEE_CHROMIUM` | `chromiumPath` |
| `OPENCODE_SEE_VIEWPORT_WIDTH` | `viewport.width` |
| `OPENCODE_SEE_VIEWPORT_HEIGHT` | `viewport.height` |
| `OPENCODE_SEE_VIRTUAL_TIME_BUDGET_MS` | `virtualTimeBudgetMs` |
| `OPENCODE_SEE_SCREENSHOT_TIMEOUT_MS` | `screenshotTimeoutMs` |
| `OPENCODE_SEE_DELEGATE_ENABLED` | `visionDelegate.enabled` |
| `OPENCODE_SEE_DELEGATE_MODEL` | `visionDelegate.model` |
| `OPENCODE_SEE_DELEGATE_PROMPT` | `visionDelegate.prompt` |
| `OPENCODE_SEE_DELEGATE_TIMEOUT_MS` | `visionDelegate.timeoutMs` |
| `OPENCODE_SEE_DELEGATE_DELETE_AFTER` | `visionDelegate.deleteAfter` |

Для логических значений работают `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`.
`forceFor` задаётся в JSON-файле.

Старые `visionDelegate.providerID` и `modelID`, а также
`OPENCODE_SEE_DELEGATE_PROVIDER_ID` и `OPENCODE_SEE_DELEGATE_MODEL_ID` остаются
совместимыми. В новых настройках используй `model`. В файле оно важнее раздельных
полей. `OPENCODE_SEE_DELEGATE_MODEL` из окружения имеет приоритет над всеми
полями модели; без него раздельные переменные заменяют соответствующие значения
из файла.
