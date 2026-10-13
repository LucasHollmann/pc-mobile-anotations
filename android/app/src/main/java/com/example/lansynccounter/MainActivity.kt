package com.example.lansynccounter

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.lansynccounter.data.CounterEntity
import com.example.lansynccounter.data.CounterDatabase
import com.example.lansynccounter.data.CounterRepository
import com.example.lansynccounter.sync.LanSyncClient
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var repository: CounterRepository
    private lateinit var syncClient: LanSyncClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        repository = CounterRepository(CounterDatabase.getInstance(applicationContext))
        syncClient = LanSyncClient(applicationContext, repository)

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CounterScreen(repository, syncClient)
                }
            }
        }
    }

    override fun onDestroy() {
        syncClient.close()
        super.onDestroy()
    }
}

@Composable
private fun CounterScreen(repository: CounterRepository, syncClient: LanSyncClient) {
    val counter by repository.observeCounter().collectAsState(
        initial = CounterEntity(updatedAt = java.time.Instant.EPOCH.toString()),
    )
    val connection by syncClient.status.collectAsState()
    val lastMessage by syncClient.lastMessage.collectAsState()
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var port by remember { mutableStateOf("47831") }
    var pairingCode by remember { mutableStateOf("") }

    LaunchedEffect(repository) {
        repository.ensureCounter()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("LAN Sync Counter", style = MaterialTheme.typography.headlineMedium)
        Text(counter.value.toString(), style = MaterialTheme.typography.displayLarge)

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = { scope.launch { repository.adjust(-1L) } },
            ) {
                Text("-1")
            }
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = { scope.launch { repository.adjust(1L) } },
            ) {
                Text("+1")
            }
        }

        OutlinedTextField(
            modifier = Modifier.fillMaxWidth(),
            value = address,
            onValueChange = { address = it },
            singleLine = true,
            label = { Text("IPv4 privado do PC") },
            placeholder = { Text("192.168.1.10") },
        )
        OutlinedTextField(
            modifier = Modifier.fillMaxWidth(),
            value = port,
            onValueChange = { port = it.filter(Char::isDigit).take(5) },
            singleLine = true,
            label = { Text("Porta") },
        )
        OutlinedTextField(
            modifier = Modifier.fillMaxWidth(),
            value = pairingCode,
            onValueChange = { pairingCode = it.filter(Char::isDigit).take(6) },
            singleLine = true,
            label = { Text("Código de pareamento (somente na primeira conexão)") },
        )
        Button(
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                if (connection == "conectado" || connection == "conectando") {
                    syncClient.disconnect()
                } else {
                    val parsedPort = port.toIntOrNull()
                    if (parsedPort == null) {
                        syncClient.connect(address, -1, pairingCode)
                    } else {
                        syncClient.connect(address.trim(), parsedPort, pairingCode)
                    }
                }
            },
        ) {
            Text(if (connection == "conectado" || connection == "conectando") "Desconectar" else "Conectar")
        }
        Text("Conexão: $connection", style = MaterialTheme.typography.bodyMedium)
        Text(lastMessage, style = MaterialTheme.typography.bodySmall)
    }
}
