package co.studio404.vpn.stats

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class TunnelStats(
    val rxBytes: Long = 0,
    val txBytes: Long = 0,
    val capturedAtMs: Long = 0,
    val isConnected: Boolean = false,
) {
    companion object {
        val Empty = TunnelStats()
    }
}

data class SessionRecord(
    val id: String,
    val startedAtMs: Long,
    var endedAtMs: Long? = null,
    var rxBytes: Long = 0,
    var txBytes: Long = 0,
) {
    fun durationMs(now: Long = System.currentTimeMillis()): Long =
        (endedAtMs ?: now) - startedAtMs

    val totalBytes: Long get() = rxBytes + txBytes
}

enum class StatsPeriod(val title: String, val days: Int) {
    DAY("Сутки", 1),
    WEEK("Неделя", 7),
    MONTH("Месяц", 30),
}

data class DailyTraffic(
    val dayStartMs: Long,
    val rxBytes: Long,
    val txBytes: Long,
) {
    val totalBytes: Long get() = rxBytes + txBytes
}

object StatsAggregator {
    fun byDay(sessions: List<SessionRecord>): List<DailyTraffic> {
        val dayMs = 24L * 60 * 60 * 1000
        val buckets = linkedMapOf<Long, DailyTraffic>()
        for (session in sessions) {
            val day = session.startedAtMs / dayMs * dayMs
            val prev = buckets[day] ?: DailyTraffic(day, 0, 0)
            buckets[day] = prev.copy(
                rxBytes = prev.rxBytes + session.rxBytes,
                txBytes = prev.txBytes + session.txBytes,
            )
        }
        return buckets.values.sortedBy { it.dayStartMs }
    }

    fun sessions(all: List<SessionRecord>, period: StatsPeriod, now: Long = System.currentTimeMillis()): List<SessionRecord> {
        val dayMs = 24L * 60 * 60 * 1000
        val today = now / dayMs * dayMs
        val from = today - (period.days - 1L) * dayMs
        return all.filter { it.startedAtMs >= from }
    }
}

class StatsStore(context: Context) {
    private val dir = File(context.filesDir, "stats").also { it.mkdirs() }
    private val sessionsFile = File(dir, "sessions.json")
    private val snapshotFile = File(dir, "snapshot.json")
    private val lock = Any()

    fun readSnapshot(): TunnelStats = synchronized(lock) {
        runCatching {
            val json = JSONObject(snapshotFile.readText())
            TunnelStats(
                rxBytes = json.optLong("rxBytes"),
                txBytes = json.optLong("txBytes"),
                capturedAtMs = json.optLong("capturedAtMs"),
                isConnected = json.optBoolean("isConnected"),
            )
        }.getOrDefault(TunnelStats.Empty)
    }

    fun writeSnapshot(stats: TunnelStats) = synchronized(lock) {
        val json = JSONObject()
            .put("rxBytes", stats.rxBytes)
            .put("txBytes", stats.txBytes)
            .put("capturedAtMs", stats.capturedAtMs)
            .put("isConnected", stats.isConnected)
        snapshotFile.writeText(json.toString())
    }

    fun readSessions(): List<SessionRecord> = synchronized(lock) {
        runCatching {
            val arr = JSONArray(sessionsFile.readText())
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        SessionRecord(
                            id = o.getString("id"),
                            startedAtMs = o.getLong("startedAtMs"),
                            endedAtMs = if (o.isNull("endedAtMs")) null else o.getLong("endedAtMs"),
                            rxBytes = o.optLong("rxBytes"),
                            txBytes = o.optLong("txBytes"),
                        ),
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    fun openSession(at: Long = System.currentTimeMillis()): String = synchronized(lock) {
        val sessions = readSessionsUnlocked().toMutableList()
        for (i in sessions.indices) {
            if (sessions[i].endedAtMs == null) {
                sessions[i] = sessions[i].copy(endedAtMs = sessions[i].startedAtMs)
            }
        }
        val id = UUID.randomUUID().toString()
        sessions += SessionRecord(id = id, startedAtMs = at)
        writeSessionsUnlocked(sessions, at)
        id
    }

    fun updateSession(
        id: String,
        rxBytes: Long,
        txBytes: Long,
        endedAtMs: Long? = null,
        now: Long = System.currentTimeMillis(),
    ) = synchronized(lock) {
        val sessions = readSessionsUnlocked().toMutableList()
        val index = sessions.indexOfFirst { it.id == id }
        if (index < 0) return
        val current = sessions[index]
        sessions[index] = current.copy(
            rxBytes = rxBytes,
            txBytes = txBytes,
            endedAtMs = endedAtMs ?: current.endedAtMs,
        )
        writeSessionsUnlocked(sessions, now)
    }

    private fun readSessionsUnlocked(): List<SessionRecord> {
        if (!sessionsFile.exists()) return emptyList()
        return runCatching {
            val arr = JSONArray(sessionsFile.readText())
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    add(
                        SessionRecord(
                            id = o.getString("id"),
                            startedAtMs = o.getLong("startedAtMs"),
                            endedAtMs = if (o.isNull("endedAtMs")) null else o.getLong("endedAtMs"),
                            rxBytes = o.optLong("rxBytes"),
                            txBytes = o.optLong("txBytes"),
                        ),
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private fun writeSessionsUnlocked(sessions: List<SessionRecord>, now: Long) {
        val cutoff = now - RETENTION_MS
        val kept = sessions.filter { it.startedAtMs >= cutoff }
        val arr = JSONArray()
        for (s in kept) {
            arr.put(
                JSONObject()
                    .put("id", s.id)
                    .put("startedAtMs", s.startedAtMs)
                    .put("endedAtMs", s.endedAtMs ?: JSONObject.NULL)
                    .put("rxBytes", s.rxBytes)
                    .put("txBytes", s.txBytes),
            )
        }
        sessionsFile.writeText(arr.toString())
    }

    companion object {
        private val RETENTION_MS = 90L * 24 * 60 * 60 * 1000
    }
}
