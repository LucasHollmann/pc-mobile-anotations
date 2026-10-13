package com.example.lansynccounter.sync

import android.content.Context
import android.os.Build
import androidx.core.content.edit
import com.example.lansynccounter.data.CounterRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

class LanSyncClient(
    context: Context,
    private val repository: CounterRepository,
) {
    private val preferences = context.getSharedPreferences("lan-sync", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _status = MutableStateFlow("desconectado")
    private val _lastMessage = MutableStateFlow("pronto")
    val status: StateFlow<String> = _status
    val lastMessage: StateFlow<String> = _lastMessage

    @Volatile
    private var webSocket: WebSocket? = null

    fun connect(host: String, port: Int, pairingCode: String) {
        if (!isPrivateIpv4(host)) {
            _lastMessage.value = "Informe um endereço IPv4 privado da rede local."
            return
        }
        if (port !in 1..65535) {
            _lastMessage.value = "A porta deve estar entre 1 e 65535."
            return
        }

        val token = preferences.getString("device_token", null)
        if (token == null && !pairingCode.matches(Regex("\\d{6}"))) {
            _lastMessage.value = "Informe o código de pareamento exibido no desktop."
            return
        }

        disconnect()
        _status.value = "conectando"
        _lastMessage.value = "Conectando ao desktop..."
        val request = Request.Builder().url("ws://$host:$port/ws").build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(socket: WebSocket, response: Response) {
                _status.value = "conectado"
                if (token != null) {
                    sendHello(socket, token)
                } else {
                    val payload = JSONObject()
                        .put("deviceName", Build.MODEL ?: "Android")
                        .put("code", pairingCode)
                    socket.send(envelope("pair", payload))
                    _lastMessage.value = "Solicitação de pareamento enviada."
                }
            }

            override fun onMessage(socket: WebSocket, text: String) {
                processMessage(socket, text)
            }

            override fun onClosed(socket: WebSocket, code: Int, reason: String) {
                if (webSocket === socket) {
                    webSocket = null
                    _status.value = "desconectado"
                }
                if (reason.isNotBlank()) _lastMessage.value = reason
            }

            override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
                if (webSocket === socket) {
                    webSocket = null
                    _status.value = "desconectado"
                }
                _lastMessage.value = "Falha de conexão: ${error.message ?: "erro de rede"}"
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "Desconectado pelo usuário")
        webSocket = null
        _status.value = "desconectado"
    }

    fun close() {
        disconnect()
        scope.cancel()
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    private fun processMessage(socket: WebSocket, text: String) {
        val message = try {
            JSONObject(text)
        } catch (_: Exception) {
            _lastMessage.value = "O desktop enviou uma mensagem inválida."
            return
        }

        val type = message.opt("type") as? String ?: ""
        val id = message.opt("id") as? String ?: ""
        val payload = message.optJSONObject("payload")
        if (type.isBlank() || type.length > 40 || id.isBlank() || id.length > 128 || payload == null) {
            _lastMessage.value = "O desktop enviou uma mensagem incompleta."
            return
        }

        when (type) {
            "pair_result" -> {
                if (payload.optString("status") != "accepted") {
                    _lastMessage.value = "O pareamento foi recusado."
                    return
                }
                val token = payload.optString("token")
                if (token.isBlank()) {
                    _lastMessage.value = "A resposta de pareamento não contém credencial."
                    return
                }
                preferences.edit { putString("device_token", token) }
                sendHello(socket, token)
                _lastMessage.value = "Dispositivo pareado com o desktop."
            }

            "hello" -> {
                _status.value = "conectado"
                _lastMessage.value = "Conectado ao desktop."
            }

            "counter_sync" -> {
                val rawValue = payload.opt("value") as? Number
                val rawVersion = payload.opt("version") as? Number
                val value = rawValue?.toLong()
                val version = rawVersion?.toLong()
                val updatedAt = payload.opt("updatedAt") as? String
                if (
                    rawValue == null ||
                    rawVersion == null ||
                    value == null ||
                    version == null ||
                    rawValue.toDouble() != value.toDouble() ||
                    rawVersion.toDouble() != version.toDouble() ||
                    value == Long.MIN_VALUE ||
                    version < 0 ||
                    updatedAt.isNullOrBlank()
                ) {
                    _lastMessage.value = "O desktop enviou um contador inválido."
                    return
                }
                try {
                    Instant.parse(updatedAt)
                } catch (_: Exception) {
                    _lastMessage.value = "A data do contador enviada pelo desktop é inválida."
                    return
                }

                scope.launch {
                    try {
                        val receipt = repository.applySync(id, value, version, updatedAt)
                        socket.send(
                            envelope(
                                "counter_sync_result",
                                JSONObject()
                                    .put("status", receipt.status)
                                    .put("value", receipt.value)
                                    .put("version", receipt.version),
                                id,
                            ),
                        )
                        _lastMessage.value = "Contador sincronizado: ${receipt.value}."
                    } catch (error: Exception) {
                        _lastMessage.value = "Falha ao salvar o contador no Room: ${error.message ?: "erro local"}"
                    }
                }
            }

            "error" -> _lastMessage.value = payload.optString("message", "Erro enviado pelo desktop.")
            "pong" -> _lastMessage.value = "Conexão ativa."
            else -> _lastMessage.value = "Tipo de mensagem não suportado: $type"
        }
    }

    private fun sendHello(socket: WebSocket, token: String) {
        socket.send(
            envelope(
                "hello",
                JSONObject()
                    .put("app", "android")
                    .put("protocolVersion", 1)
                    .put("deviceName", Build.MODEL ?: "Android")
                    .put("token", token),
            ),
        )
    }

    private fun envelope(type: String, payload: JSONObject, id: String = UUID.randomUUID().toString()) =
        JSONObject()
            .put("type", type)
            .put("id", id)
            .put("payload", payload)
            .toString()

    private fun isPrivateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4) return false
        val octets = parts.map { it.toIntOrNull() ?: return false }
        if (octets.any { it !in 0..255 }) return false

        return octets[0] == 10 ||
            (octets[0] == 172 && octets[1] in 16..31) ||
            (octets[0] == 192 && octets[1] == 168)
    }
}
