# LAN Sync Counter protocol

Protocol version `1` uses JSON messages over a WebSocket at `ws://<private-ip>:47831/ws`. The Electron main process owns the HTTP and WebSocket server on port `47831`; `GET /health` is available for local diagnostics. The desktop is authoritative for a desktop-initiated counter sync.

## Envelope

Every WebSocket message has a non-empty `type`, a unique `id`, and a `payload` object:

```json
{
  "type": "counter_sync",
  "id": "a-unique-operation-id",
  "payload": {
    "value": 42,
    "version": 7,
    "updatedAt": "2026-10-12T20:00:00.000Z"
  }
}
```

The server limits each received WebSocket frame to 8 KiB and rejects invalid envelopes, unknown message types, and invalid message-specific payloads.

## Pairing and authentication

The desktop user generates a six-digit pairing code in the desktop UI. It expires after two minutes and is valid for one pairing. The Android app sends it with its device name:

```json
{
  "type": "pair",
  "id": "pair-request-id",
  "payload": {
    "deviceName": "Android Device",
    "code": "012345"
  }
}
```

On success, `pair_result` returns a random device ID and a random, persistent device credential. The Android app stores the credential in app-private preferences; the desktop stores only its SHA-256 hash in its local SQLite database. The credential must not be logged or shared.

```json
{
  "type": "pair_result",
  "id": "pair-request-id",
  "payload": {
    "status": "accepted",
    "deviceId": "device-id",
    "token": "device-credential"
  }
}
```

On each connection the Android app authenticates with `hello`:

```json
{
  "type": "hello",
  "id": "hello-id",
  "payload": {
    "app": "android",
    "protocolVersion": 1,
    "deviceName": "Android Device",
    "token": "device-credential"
  }
}
```

The server answers with `hello` and `payload.status: "connected"` only after authenticating the credential. Unpaired devices cannot send or receive counter synchronisation operations.

## Counter synchronisation

The desktop reads the persisted SQLite record when the user starts a sync, records an operation in `sync_outbox`, then sends `counter_sync`. The Android persists it in Room before replying with the same operation ID:

```json
{
  "type": "counter_sync_result",
  "id": "a-unique-operation-id",
  "payload": {
    "status": "applied",
    "value": 42,
    "version": 7
  }
}
```

Only a matching `applied` acknowledgement marks the operation and superseded earlier counter changes acknowledged in the desktop outbox. A rejected response, disconnect, send failure, or ten-second acknowledgement timeout leaves the operation pending. Android records applied operation IDs in Room, so replaying the same operation is idempotent and still receives the original receipt.

The desktop value replaces the Android value during this one-way sync. Android-local `+1` / `-1` changes are not merged or sent back to the PC.

## Other messages

- `error`: `{ "type": "error", "id": "...", "payload": { "code": "...", "message": "..." } }`
- `ping` / `pong`: optional connection health messages with empty payloads.

## Network and security limitations

The Android client accepts only RFC 1918 private IPv4 addresses. Connect both devices to the same trusted LAN; Ethernet on the PC and Wi-Fi on the phone are supported when the router allows client-to-client traffic. No router port forwarding or internet access is required.

The initial protocol uses `ws://` without TLS. Traffic, including the pairing exchange, is not encrypted; use only a trusted private network and do not synchronise sensitive data. Android cleartext networking is enabled at the app level because the user-supplied private IPv4 address is dynamic; the client validates the address before opening a connection.
