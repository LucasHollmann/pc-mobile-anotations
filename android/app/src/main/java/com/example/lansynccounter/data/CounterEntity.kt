package com.example.lansynccounter.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "counter")
data class CounterEntity(
    @PrimaryKey val id: Int = 1,
    val value: Long = 0,
    val updatedAt: String,
    val version: Long = 0,
)

@Entity(tableName = "applied_sync_operations")
data class AppliedSyncOperationEntity(
    @PrimaryKey val operationId: String,
    val value: Long,
    val version: Long,
)

data class SyncReceipt(
    val status: String,
    val value: Long,
    val version: Long,
)
