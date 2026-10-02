<h1 align="center">opencode-see</h1>

<p align="center"><strong>Дай агенту OpenCode посмотреть на картинку.</strong><br>
Локальные файлы, вложения чата и скриншоты страниц — прямо в активную vision-модель<br>
или на описание vision-делегату с уже настроенной в OpenCode авторизацией.</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.ru.md"><strong>Русский</strong></a>
</p>

<p align="center">
  <a href="https://github.com/Krablante/opencode-see/releases">Релизы</a> ·
  <a href="./docs/usage.ru.md">Использование</a> ·
  <a href="./docs/configuration.ru.md">Настройка</a> ·
  <a href="./docs/operations.ru.md">Эксплуатация</a> ·
  <a href="./docs/architecture.ru.md">Архитектура</a>
</p>

<p align="center">
  <img alt="Локальная картинка, вложение OpenCode, vision-модель" src="./assets/stickers-ru.svg" width="720">
</p>

## Что делает плагин

`opencode-see` добавляет два инструмента в OpenCode и OpenCodez. `image_view`
открывает PNG, JPEG, WebP и GIF с диска либо находит изображения, уже приложенные
в текущем чате. `screenshot` снимает HTTP- или HTTPS-страницу локальным Chromium.

Модель с поддержкой изображений получает обычные файловые вложения OpenCode.
Текстовая модель получает ответ настроенного vision-делегата. Делегат смотрит
на пиксели и отвечает на конкретный визуальный вопрос; собственных инструментов
у него нет. Авторизацией провайдеров и запросами к моделям занимается OpenCode.

Плагин пригодится, чтобы прочитать ошибку со скриншота, сравнить работающий
интерфейс с макетом или разобраться в диаграмме без отдельного сервиса загрузки.
Один плагин работает в обычном OpenCode и совместимых форках без патча ядра.

## Как это выглядит

<p align="center">
  <img alt="Иллюстрация вызовов инструментов с настоящими метаданными изображений и захватом Chromium" src="./assets/demo-ru.gif" width="900">
</p>

Это иллюстрация, собранная из результатов настоящих функций чтения изображений
и захвата Chromium. Вызовы инструментов показаны как примеры; это не команды
оболочки и не запись ответа модели. Требования для воспроизведения описаны в
[руководстве для разработчиков](./CONTRIBUTING.ru.md).

## Установка

Нужны Node.js 22 или новее и OpenCode либо OpenCodez. Chromium необязателен:
его использует только `screenshot`. Плагин распространяется через **этот
репозиторий GitHub**. Одноимённый пакет `opencode-see` в npm относится к другому
проекту.

```bash
git clone https://github.com/Krablante/opencode-see.git \
  ~/.local/share/opencode/plugins/opencode-see
cd ~/.local/share/opencode/plugins/opencode-see
npm ci --omit=dev
```

Добавь исходник в массив `plugin` файла `~/.config/opencode/opencode.jsonc`.
Замени путь на свой абсолютный:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///home/you/.local/share/opencode/plugins/opencode-see/src/index.ts"
  ]
}
```

Перезапусти OpenCode. Для OpenCodez редактируй
`~/.config/opencodez/opencode.jsonc`. Точка входа у обоих одна. В Windows выбери
постоянный каталог для клона и абсолютный URL, например
`file:///C:/Users/you/plugins/opencode-see/src/index.ts`.

## Использование

Попроси агента обычным языком:

```text
Вызови image_view для ./design/home.webp. Что не так с раскладкой?
Прочитай точный текст ошибки с только что приложенной картинки.
Сними http://localhost:3000 в 1440×900 и сравни с ~/Pictures/reference.png.
```

| Инструмент | Вход | Результат |
| --- | --- | --- |
| `image_view` | `paths` либо `source: "latest"` / `"session"`; необязательный `question` | До пяти картинок с метаданными и вложениями либо ответом делегата |
| `screenshot` | `url`; необязательные `output_path`, `width`, `height`, `question` | Сохранённый PNG, метаданные захвата и картинка либо ответ делегата |

Локальным файлам нужно разрешение OpenCode на чтение. Скриншоты по умолчанию
попадают в `<активный проект>/.opencode/screenshots`. Ограничение на картинку —
20 MiB. PDF не поддерживается.

Для нативного vision настройка плагина не нужна. Для текстовой модели выбери
авторизованную модель с поддержкой картинок из `opencode models` и укажи её в
`~/.config/opencode/opencode-see.json`. OpenCodez использует свой каталог
конфигурации:

```json
{
  "visionDelegate": {
    "model": "your-provider/your-vision-model"
  }
}
```

Делегирование включено по умолчанию и расходует кредиты выбранного провайдера.
Начальное значение — `opencode-go/gpt-5.6-luna`; выбери модель, доступную твоему
аккаунту. [Настройка](./docs/configuration.ru.md) описывает принудительные
маршруты, таймауты и переменные окружения.

## Подробнее

- [Использование](./docs/usage.ru.md): аргументы, картинки из сессии и примеры.
- [Настройка](./docs/configuration.ru.md): параметры и выбор маршрута к модели.
- [Эксплуатация](./docs/operations.ru.md): обновление, браузер и устранение проблем.
- [Архитектура](./docs/architecture.ru.md): обязанности частей, поток данных и стоимость операций.
- [Разработка](./CONTRIBUTING.ru.md) · [Безопасность](./SECURITY.ru.md) · [История изменений](./CHANGELOG.ru.md).

Лицензия — [MIT](./LICENSE). Сведения о заимствованиях — в [NOTICE](./NOTICE).
