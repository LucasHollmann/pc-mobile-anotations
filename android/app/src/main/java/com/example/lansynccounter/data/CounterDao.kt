package com.example.lansynccounter.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface CounterDao {
    @Query("SELECT * FROM counter WHERE id = 1")
    fun observeCounter(): Flow<CounterEntity?>

    @Query("SELECT * FROM counter WHERE id = 1")
    suspend fun getCounter(): CounterEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveCounter(counter: CounterEntity)

    @Query("SELECT * FROM applied_sync_operations WHERE operationId = :operationId")
    suspend fun getAppliedOperation(operationId: String): AppliedSyncOperationEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun saveAppliedOperation(operation: AppliedSyncOperationEntity)
}
