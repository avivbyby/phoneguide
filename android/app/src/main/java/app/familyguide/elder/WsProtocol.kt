package app.familyguide.elder

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Kotlin mirror of shared/src/protocol.ts (WsClientMessage / WsServerMessage).
 * Field names must stay exactly: type, code, role, payload.
 */
sealed interface WsClientMessage {
    data object Create : WsClientMessage
    data class Join(val code: String) : WsClientMessage
    data class Signal(val payload: JsonElement) : WsClientMessage
    data object Hangup : WsClientMessage
}

sealed interface WsServerMessage {
    data class Created(val code: String) : WsServerMessage
    data class Joined(val role: String) : WsServerMessage
    data object PeerJoined : WsServerMessage
    data class Signal(val payload: JsonElement) : WsServerMessage
    data object PeerLeft : WsServerMessage
    data class Error(val code: String) : WsServerMessage
}

object WsProtocol {
    private val json = Json

    fun encode(message: WsClientMessage): String {
        val obj = when (message) {
            WsClientMessage.Create -> buildJsonObject { put("type", "create") }
            is WsClientMessage.Join -> buildJsonObject {
                put("type", "join")
                put("code", message.code)
            }
            is WsClientMessage.Signal -> buildJsonObject {
                put("type", "signal")
                put("payload", message.payload)
            }
            WsClientMessage.Hangup -> buildJsonObject { put("type", "hangup") }
        }
        return obj.toString()
    }

    /** Returns null for anything that is not a well-formed server message. */
    fun parseServer(text: String): WsServerMessage? {
        val obj = try {
            json.parseToJsonElement(text) as? JsonObject
        } catch (_: IllegalArgumentException) {
            null
        } ?: return null

        return when (obj.string("type")) {
            "created" -> obj.string("code")?.let { WsServerMessage.Created(it) }
            "joined" -> obj.string("role")
                ?.takeIf { it == "elder" || it == "helper" }
                ?.let { WsServerMessage.Joined(it) }
            "peer-joined" -> WsServerMessage.PeerJoined
            "signal" -> obj["payload"]?.let { WsServerMessage.Signal(it) }
            "peer-left" -> WsServerMessage.PeerLeft
            "error" -> obj.string("code")?.let { WsServerMessage.Error(it) }
            else -> null
        }
    }

    /** Parses a JSON text payload; throws IllegalArgumentException if it is not JSON. */
    fun parsePayload(text: String): JsonElement = json.parseToJsonElement(text)

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
}
