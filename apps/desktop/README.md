# 404VPN Desktop (Windows + macOS)

Десктоп-клиент 404VPN (Electron + системный туннель). Тот же API, что у iOS: код → Connect / Disconnect, баланс, DNS-фильтр, отвязка устройства.

## Требования

- Node.js 20+
- Go 1.22+ (для `tunnel-helper`)
- Windows: админ-права при запуске (маршруты / сетевой адаптер)
- macOS: admin prompt при Connect (utun + route/DNS)

## Разработка

```bash
cd apps/desktop
npm install
npm run build:helper          # нужен Go
node scripts/fetch-wintun.mjs # только Windows — wintun.dll рядом с helper
npm run dev
```

## Сборка установщиков

```bash
# Windows (на Windows-машине)
npm run dist:win
# → ../../releases/desktop/404VPN-Setup-1.0.0.exe

# macOS (на Mac)
npm run dist:mac
# → ../../releases/desktop/404VPN-1.0.0-arm64.dmg (и amd64)
```

Для раздачи по ссылке скопируй артефакты в `releases/desktop/public/` под стабильными именами:

```bash
mkdir -p ../../releases/desktop/public
cp ../../releases/desktop/404VPN-Setup-*.exe ../../releases/desktop/public/404VPN-Setup.exe
# на Mac:
cp ../../releases/desktop/404VPN-*-arm64.dmg ../../releases/desktop/public/404VPN.dmg
cp apps/desktop/download/index.html ../../releases/desktop/public/index.html
```

После деплоя Caddy отдаёт (домен VPN = `DOMAIN` в `.env`, у тебя это):

- `https://404studiotech-miniapp.ru/download/` — страница скачивания
- `https://404studiotech-miniapp.ru/download/404VPN-Setup.exe`
- `https://404studiotech-miniapp.ru/download/404VPN.dmg` (когда соберёшь на Mac)

`404studiotech.ru` — сайт студии, не VPN; туда установщик сам не попадёт.

## Windows: системный модуль туннеля

Для Windows в `tunnel/dist/` нужен `wintun.dll` (кладётся при `npm run fetch:wintun` или вручную рядом с `tunnel-helper.exe` перед `npm run dist:win`).

## Заметки

- Бэкенд не менялся: в админке `platform` у десктоп-устройств будет `ios` (хардкод redeem). Имя устройства — `Windows · <host>` / hostname Mac.
- Установщики без code signing: SmartScreen / Gatekeeper покажут предупреждение.
- Connect поднимает маршруты/DNS и на Windows обычно требует запуск от администратора.
- API: `https://404studiotech-miniapp.ru` (константа в `src/shared/config.ts`).
- macOS DMG собирается только на Mac: `npm run dist:mac`.
