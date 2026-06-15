"""Constants for the translation agent."""

from __future__ import annotations

# --- Gemini Live ---

GEMINI_MODEL = "gemini-3.5-live-translate-preview"

# Gemini Live API audio formats.
GEMINI_INPUT_SAMPLE_RATE = 16000  # Gemini expects 16kHz mono PCM in
GEMINI_OUTPUT_SAMPLE_RATE = 24000  # Gemini emits 24kHz mono PCM out
AUDIO_CHANNELS = 1

# --- LiveKit ---

# Track attribute keys for translator-published tracks.
TRACK_ATTR_KIND = "kind"
TRACK_ATTR_SOURCE_IDENTITY = "source_identity"
TRACK_ATTR_TARGET_LANG = "target_lang"

# Marker value for the `kind` attribute on translator tracks.
TRANSLATION_TRACK_KIND = "translation"

# --- Translation Memory ---

# Max transcript entries kept in rolling context for session memory.
MAX_TRANSCRIPT_HISTORY = 30
# Max structured segments kept in rolling context.
MAX_HISTORY_SEGMENTS = 20
# Max words across all history entries before oldest are dropped.
MAX_HISTORY_WORDS = 600

# Participant attribute carrying each participant's chosen language.
PARTICIPANT_LANG_ATTR = "lang"

# Participant attribute key for glossary (JSON array of {source, translation}).
GLOSSARY_ATTR = "orbit_glossary"

# Content-type constants for participant's orbit_content_type attribute.
CONTENT_TYPE_NORMAL = "normal"
CONTENT_TYPE_MOVIE = "movie"
CONTENT_TYPE_CINEMATIC_FAITHFUL = "cinematic_faithful"

# Sentinel meaning "no translation, native passthrough."
NATIVE_LANG = "none"

# --- Router behavior ---

# Debounce window for room state changes before reconciling sessions.
RECONCILE_DEBOUNCE_SEC = 0.25

# How long to keep a session warm after its last demand disappears
# (speaker mutes, or the last listener for a target language leaves).
SESSION_GRACE_SEC = 10.0

# --- Voice pool for multi-speaker translation ---

# When multiple speakers are detected in the input audio, the translator
# assigns each speaker a distinct voice from this pool. Each entry is a
# (voice_name, description) tuple describing the vocal character.
# The first voice is the default for the first detected speaker.
AVAILABLE_VOICES: list[tuple[str, str]] = [
    # Group 1
    ("Zephyr", "Bright — high energy, clear articulation, female"),
    ("Kore", "Firm — assertive, confident delivery, female"),
    ("Orus", "Firm — strong, authoritative tone, male"),
    ("Autonoe", "Bright — clear, vibrant expression, female"),
    ("Umbriel", "Easy-going — relaxed, conversational, male"),
    ("Erinome", "Clear — crisp, distinct articulation, female"),
    ("Laomedeia", "Upbeat — positive, energetic style, female"),
    ("Schedar", "Even — balanced, consistent tone, male"),
    ("Achird", "Friendly — warm, approachable tone, male"),
    ("Sadachbia", "Lively — spirited, animated delivery, female"),
    # Group 2
    ("Puck", "Upbeat — cheerful, enthusiastic tone, male"),
    ("Fenrir", "Excitable — energetic, animated expression, male"),
    ("Aoede", "Breezy — casual, relaxed delivery, female"),
    ("Enceladus", "Breathy — soft, airy quality, male"),
    ("Algieba", "Smooth — polished, fluid delivery, male"),
    ("Algenib", "Gravelly — rough, textured quality, male"),
    ("Achernar", "Soft — gentle, mellow tone, female"),
    ("Gacrux", "Mature — experienced, seasoned quality, female"),
    ("Zubenelgenubi", "Casual — informal, conversational, male"),
    ("Sadaltager", "Knowledgeable — informed, instructive, male"),
    # Group 3
    ("Charon", "Informative — educational, explanatory style, male"),
    ("Leda", "Youthful — young-sounding, fresh voice, female"),
    ("Callirrhoe", "Easy-going — laid-back, comfortable style, female"),
    ("Iapetus", "Clear — precise, well-articulated, male"),
    ("Despina", "Smooth — refined, elegant tone, female"),
    ("Rasalgethi", "Informative — educational, instructive, male"),
    ("Alnilam", "Firm — steady, resolute delivery, male"),
    ("Pulcherrima", "Forward — direct, straightforward style, female"),
    ("Vindemiatrix", "Gentle — soft, kind delivery, female"),
    ("Sulafat", "Warm — rich, comforting tone, female"),
]

# --- Gemini connection ---

# Exponential backoff schedule for reconnecting a failed Gemini session.
GEMINI_RECONNECT_BACKOFF_SEC = [0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0]
GEMINI_MAX_FAILURES_BEFORE_LONG_BACKOFF = 5
