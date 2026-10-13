# LAN Sync Counter

A Windows desktop app and native Android app for locally persisted counter data and one-way PC-to-Android synchronisation over a trusted LAN. The Electron main process hosts the HTTP/WebSocket server; there is no cloud or external service.

## Requirements

- Node.js 22+ and npm for the desktop
- Android Studio with Android SDK Platform 35 and Build Tools for Android
- Java 17+ for Gradle (Android Studio's bundled JDK is suitable)

## Start the desktop

From the repository root, install the npm workspace dependencies once:

```powershell
npm install
```

Then start the Electron desktop app:

```powershell
npm run dev
```

The development command runs Vite and Electron and starts the LAN HTTP/WebSocket server on port `47831`. `better-sqlite3` uses a platform prebuilt binary. The database is created in Electron's user data directory. To run checks and unit tests:

```powershell
npm test
npm run build
```

To use another port, set `LAN_SYNC_PORT` before starting Electron, for example:

```powershell
$env:LAN_SYNC_PORT = "47832"
npm run dev
```

To permit phone-to-PC connections, allow the desktop app or the selected TCP port on Windows Firewall for **Private networks only**. Do not disable the firewall or create router port forwarding.

## Build and run Android

Open the `android/` directory in Android Studio, let Gradle sync, select an emulator or USB-connected device, and press **Run**. Enable USB debugging for a physical device. Android Studio must use JDK 17 or newer.

This repository currently does not include the Gradle wrapper. If Android Studio cannot sync it directly, install Gradle and run this once from the `android/` directory with JDK 17+ selected:

```powershell
gradle wrapper --gradle-version 8.9 --distribution-type bin
.\gradlew.bat installDebug
```

## Pair and synchronise

1. Start the desktop app. It shows private IPv4 addresses and the local server state.
2. Choose **Gerar código de pareamento** on the desktop.
3. On Android, enter one of the displayed PC IPv4 addresses, port `47831`, and the six-digit code. Select **Conectar**.
4. Once paired, the Android app saves its device credential locally. Future connections use the saved credential; the code is only needed for first pairing.
5. Use **Sincronizar com Android** on the desktop. The phone persists the received counter in Room before acknowledging; the desktop reports success only after that acknowledgement.

The PC's persisted counter is the source of truth for this one-way operation. Android-local changes are stored but are replaced by the next desktop sync; values are not merged.

## Network and security notes

- Keep both devices on the same trusted LAN. PC Ethernet and phone Wi-Fi work if the network permits communication between clients.
- The Android client accepts only RFC 1918 private IPv4 addresses. Guest Wi-Fi or client isolation may block the connection.
- The prototype uses `ws://` without TLS. Pairing credentials and counter traffic are not encrypted; do not send sensitive data.
- Android permits cleartext only in this app, and the client validates the entered address as a private IPv4 before connecting.
- The desktop server's HTTP health check is `http://<pc-ip>:47831/health`; the WebSocket endpoint is `ws://<pc-ip>:47831/ws`.
