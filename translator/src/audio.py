"""Audio frame plumbing for the translation agent."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

from livekit import rtc

from config import AUDIO_CHANNELS, GEMINI_INPUT_SAMPLE_RATE, GEMINI_OUTPUT_SAMPLE_RATE

logger = logging.getLogger("translator.audio")


class MultiplexedAudioStream:
    def __init__(self, track: rtc.RemoteAudioTrack):
        self._track = track
        self._subscribers: set[asyncio.Queue[bytes]] = set()
        self._closed = False
        self._task = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        stream = rtc.AudioStream(
            self._track,
            sample_rate=GEMINI_INPUT_SAMPLE_RATE,
            num_channels=AUDIO_CHANNELS,
        )
        try:
            async for ev in stream:
                if self._closed:
                    break
                data = bytes(ev.frame.data)
                for q in list(self._subscribers):
                    try:
                        q.put_nowait(data)
                    except asyncio.QueueFull:
                        pass
        except Exception as e:
            logger.error("MultiplexedAudioStream pump error: %s", e)
        finally:
            await stream.aclose()
            for q in self._subscribers:
                try:
                    q.put_nowait(b"")
                except asyncio.QueueFull:
                    pass

    def subscribe(self) -> asyncio.Queue[bytes]:
        q = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[bytes]) -> None:
        self._subscribers.discard(q)

    async def aclose(self) -> None:
        self._closed = True
        if self._task:
            self._task.cancel()
            import contextlib

            with contextlib.suppress(asyncio.CancelledError):
                await self._task


_track_multiplexers: dict[str, MultiplexedAudioStream] = {}


async def iter_pcm_for_gemini(
    track: rtc.RemoteAudioTrack,
) -> AsyncIterator[bytes]:
    """Read PCM frames from a LiveKit track, downsample to 16 kHz mono,
    yield raw little-endian int16 bytes ready for Gemini Live input.
    Multiplexes so multiple sessions can read from the same track."""

    if track.sid not in _track_multiplexers:
        _track_multiplexers[track.sid] = MultiplexedAudioStream(track)

    mux = _track_multiplexers[track.sid]
    q = mux.subscribe()

    try:
        while True:
            chunk = await q.get()
            if not chunk:
                break
            yield chunk
    finally:
        mux.unsubscribe(q)
        if not mux._subscribers:
            mux_to_close = _track_multiplexers.pop(track.sid, None)
            if mux_to_close:
                asyncio.create_task(mux_to_close.aclose())


def make_audio_source() -> rtc.AudioSource:
    """An AudioSource sized for Gemini's 24 kHz mono output."""
    return rtc.AudioSource(GEMINI_OUTPUT_SAMPLE_RATE, AUDIO_CHANNELS)


async def push_pcm_to_source(
    source: rtc.AudioSource,
    pcm_bytes: bytes,
) -> None:
    """Wrap a raw 24 kHz mono int16 PCM chunk in an AudioFrame and capture it."""
    import array

    samples = array.array("h")
    samples.frombytes(pcm_bytes)
    frame = rtc.AudioFrame(
        data=samples.tobytes(),
        sample_rate=GEMINI_OUTPUT_SAMPLE_RATE,
        num_channels=AUDIO_CHANNELS,
        samples_per_channel=len(samples),
    )
    try:
        await source.capture_frame(frame)
    except Exception as exc:
        # The source can be closed concurrently when the session tears down.
        if "closed" in str(exc).lower() or "invalidstate" in str(exc).lower():
            logger.debug("AudioSource closed mid-capture; dropping frame")
        else:
            raise
