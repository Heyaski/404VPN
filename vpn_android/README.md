# 404VPN Android

Нативный клиент (Kotlin + Jetpack Compose). Туннель через системный `VpnService`
и библиотеку WireGuard Android (в UI не упоминается).

## Требования

- Android Studio / JDK 17+
- Android SDK 35, minSdk 26

## Сборка

```bash
cd vpn_android
./gradlew :app:assembleRelease
```

APK: `app/build/outputs/apk/release/app-release-unsigned.apk` (или signed, если настроен keystore).

Для локальной подписи release создайте `keystore.properties` (не коммитить) или подпишите
debug-сборкой для тестов:

```bash
./gradlew :app:assembleDebug
```

Скопируйте релизный APK в `releases/desktop/public/404VPN.apk` для раздачи на `/download/`.

## Возможности

- Активация кода (`platform=android`)
- Connect / Disconnect
- Баланс и статус suspended
- DNS-фильтр
- Автоподключение (always / Wi‑Fi / cellular / off)
- Отвязка устройства
