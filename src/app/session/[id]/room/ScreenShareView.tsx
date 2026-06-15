"use client";

import { useEffect, useRef, useState } from "react";
import {
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent, type Participant } from "livekit-client";
import { PARTICIPANT_LANG_ATTR } from "@/lib/config";
import { getLanguageByCode } from "@/lib/languages";

/**
 * Detects when any participant is sharing their screen and renders
 * a large preview in the stage center with sharer info and translation
 * overlay. Returns null when no screen share is active.
 */
export default function ScreenShareView({
  myLang,
}: {
  myLang: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const [activeShare, setActiveShare] = useState<{
    participant: Participant;
    track: MediaStreamTrack;
  } | null>(null);

  // Collect all participants with unmuted screen share tracks
  useEffect(() => {
    const sync = () => {
      // Check local participant first
      for (const pub of localParticipant.videoTrackPublications.values()) {
        if (
          pub.source === Track.Source.ScreenShare &&
          pub.track &&
          !pub.isMuted
        ) {
          const track = pub.track.mediaStreamTrack;
          setActiveShare((prev) => 
            prev?.track === track && prev?.participant.identity === localParticipant.identity 
              ? prev 
              : { participant: localParticipant, track }
          );
          return;
        }
      }
      // Then check remotes
      for (const p of remotes) {
        for (const pub of p.videoTrackPublications.values()) {
          if (
            pub.source === Track.Source.ScreenShare &&
            pub.track &&
            !pub.isMuted
          ) {
            const track = pub.track.mediaStreamTrack;
            setActiveShare((prev) => 
              prev?.track === track && prev?.participant.identity === p.identity 
                ? prev 
                : { participant: p, track }
            );
            return;
          }
        }
      }
      setActiveShare(null);
    };

    sync();

    const events = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ];
    for (const ev of events) {
      room.on(ev, sync);
    }
    return () => {
      for (const ev of events) {
        room.off(ev, sync);
      }
    };
  }, [localParticipant, remotes, room]);

  // Attach/detach the screen share video track to our <video> element
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeShare?.track) {
      if (video) video.srcObject = null;
      return;
    }
    const stream = new MediaStream([activeShare.track]);
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [activeShare?.track]);

  if (!activeShare) return null;

  const participant = activeShare.participant;
  const displayName = participant.name || participant.identity;
  const isLocal = participant.identity === localParticipant.identity;
  const speakerLang = participant.attributes?.[PARTICIPANT_LANG_ATTR];
  const langInfo = speakerLang ? getLanguageByCode(speakerLang) : undefined;
  const needsTranslation = !!speakerLang && speakerLang !== myLang;

  return (
    <div className="screen-share-view">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="screen-share-video"
      />
      <div className="screen-share-overlay">
        <div className="screen-share-overlay-top">
          <div className="screen-share-info">
            <span className="screen-share-name">
              {displayName}
              {isLocal ? " (You)" : ""}
            </span>
            <span className="screen-share-label"> is sharing screen</span>
          </div>
          {isLocal && (
            <button
              className="screen-share-stop-btn"
              onClick={async () => {
                for (const pub of localParticipant.videoTrackPublications.values()) {
                  if (pub.source === Track.Source.ScreenShare && pub.track) {
                    pub.track.stop();
                    await localParticipant.unpublishTrack(pub.track);
                  }
                }
                for (const pub of localParticipant.audioTrackPublications.values()) {
                  if (pub.source === Track.Source.ScreenShareAudio && pub.track) {
                    pub.track.stop();
                    await localParticipant.unpublishTrack(pub.track);
                  }
                }
              }}
            >
              Stop Sharing
            </button>
          )}
        </div>
        <div className="screen-share-overlay-bottom">
          {needsTranslation && (
            <span className="screen-share-status">
              → {getLanguageByCode(myLang)?.name || myLang} &middot; Orus
            </span>
          )}
          {langInfo && !isLocal && !needsTranslation && (
            <span className="active-speaker-lang-badge">
              {langInfo.flag} {langInfo.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
