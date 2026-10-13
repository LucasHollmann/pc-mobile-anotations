package com.example.lansynccounter.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [CounterEntity::class, AppliedSyncOperationEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class CounterDatabase : RoomDatabase() {
    abstract fun counterDao(): CounterDao

    companion object {
        @Volatile
        private var instance: CounterDatabase? = null

        fun getInstance(context: Context): CounterDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    CounterDatabase::class.java,
                    "lan-sync-counter.db",
                ).build().also { instance = it }
            }
    }
}
