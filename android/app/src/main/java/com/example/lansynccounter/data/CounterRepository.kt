package com.example.lansynccounter.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import androidx.room.withTransaction

class CounterRepository(private val database: CounterDatabase) {
    private val dao = database.counterDao()

    fun observeCounter(): Flow<CounterEntity> =
        dao.observeCounter().map { it ?: CounterEntity(updatedAt = java.time.Instant.now().toString()) }

    suspend fun ensureCounter() {
        database.withTransaction {
            if (dao.getCounter() == null) {
                dao.saveCounter(CounterEntity(updatedAt = java.time.Instant.now().toString()))
            }
        }
    }

    suspend fun adjust(delta: Long): CounterEntity = database.withTransaction {
        val current = dao.getCounter() ?: CounterEntity(updatedAt = java.time.Instant.now().toString())
        val updated = current.copy(
            value = Math.addExact(current.value, delta),
            updatedAt = java.time.Instant.now().toString(),
            version = Math.addExact(current.version, 1L),
        )
        dao.saveCounter(updated)
        updated
    }

    suspend fun applySync(
        operationId: String,
        value: Long,
        version: Long,
        updatedAt: String,
    ): SyncReceipt = database.withTransaction {
        val previous = dao.getAppliedOperation(operationId)
        if (previous != null) {
            return@withTransaction SyncReceipt("applied", previous.value, previous.version)
        }

        dao.saveCounter(CounterEntity(value = value, version = version, updatedAt = updatedAt))
        dao.saveAppliedOperation(AppliedSyncOperationEntity(operationId, value, version))
        SyncReceipt("applied", value, version)
    }
}
