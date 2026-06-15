"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  useLocalParticipant,
  useRoomContext,
  useTrackVolume,
} from "@livekit/components-react";
import { Track, LocalAudioTrack } from "livekit-client";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";
import {
  CamOffIcon,
  CamOnIcon,
  CaptionsIcon,
  MicOffIcon,
  MicOnIcon,
  ParticipantsIcon,
  ChatIcon,
  ShareScreenIcon,
  TranslateIcon,
  RecordIcon,
  MoreIcon,
  BreakoutRoomsIcon,
  SettingsIcon,
  HistoryIcon,
  InviteIcon,
  CaretUpIcon,
  HandRaiseIcon,
} from "./icons";

type NativeScreenShareBridge = {
  startScreenShare: () => void;
  stopScreenShare: () => void;
};

type NativeScreenShareWindow = Window & {
  NativeScreenShare?: NativeScreenShareBridge;
  onNativeScreenShareFrame?: (dataUrl: string) => void;
};

function getNativeScreenShareBridge() {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as NativeScreenShareWindow).NativeScreenShare;
}

function getShareErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError")) {
    return "Screen sharing was cancelled.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function waitForNativeScreenShareFrame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  return new Promise<void>((resolve, reject) => {
    let ready = false;
    const timeout = window.setTimeout(() => {
      if (!ready) {
        reject(new Error("Screen capture permission did not return a frame."));
      }
    }, 12000);

    (window as unknown as NativeScreenShareWindow).onNativeScreenShareFrame = (dataUrl: string) => {
      if (dataUrl === "error:PermissionDenied") {
        if (!ready) {
          window.clearTimeout(timeout);
          reject(new Error("Screen capture permission was denied."));
        }
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (!ready) {
          canvas.width = img.naturalWidth || 360;
          canvas.height = img.naturalHeight || 640;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        if (!ready) {
          ready = true;
          window.clearTimeout(timeout);
          resolve();
        }
      };
      img.onerror = () => {
        if (!ready) {
          window.clearTimeout(timeout);
          reject(new Error("The native screen capture frame could not be decoded."));
        }
      };
      img.src = dataUrl;
    };
  });
}

export default function ControlBar({
  onLeave,
  activeSidebar,
  onToggleSidebar,
  speakerMuted,
  onToggleSpeaker,
  handRaised,
  onToggleHand,
}: {
  onLeave: () => void;
  activeSidebar: "participants" | "captions" | "translation" | "chat" | "breakout" | null;
  onToggleSidebar: (sidebar: "participants" | "captions" | "translation" | "chat" | "breakout") => void;
  speakerMuted: boolean;
  onToggleSpeaker: () => void;
  handRaised: boolean;
  onToggleHand: () => void;
}) {
  const { localParticipant, microphoneTrack, cameraTrack } = useLocalParticipant();
  const room = useRoomContext();
  const router = useRouter();
  const [isLocalRecording, setIsLocalRecording] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareWithAudio, setShareWithAudio] = useState(true);
  const [shareStarting, setShareStarting] = useState(false);
  const [shareError, setShareError] = useState("");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const customScreenShareTrackRef = useRef<MediaStreamTrack | null>(null);
  const [customScreenShareOn, setCustomScreenShareOn] = useState(false);
  const shareConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const REACTIONS = ["✋", "👍", "👏", "😂", "❤️", "🎉", "🙌", "💯"];

  const sendReaction = (emoji: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({
      emoji,
      from: localParticipant.name || localParticipant.identity,
      fromId: localParticipant.identity,
    }));
    localParticipant.publishData(data, { topic: "react", reliable: true });
  };

  const openInvite = () => {
    setShowInviteDialog(true);
    setShowMoreMenu(false);
    setShowReactions(false);
  };

  const copyMeetingLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  function getEmailLink() {
    const subject = `Join my Orbit Meeting`;
    const body = `You are invited to join my Orbit Meeting!\n\nMeeting Link: ${window.location.href}\n\nSee you there!`;
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function getGmailLink() {
    const subject = `Join my Orbit Meeting`;
    const body = `You are invited to join my Orbit Meeting!\n\nMeeting Link: ${window.location.href}\n\nSee you there!`;
    return `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function getWhatsAppLink() {
    const text = `You are invited to join my Orbit Meeting!\n\nMeeting Link: ${window.location.href}`;
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  }

  const micOn = !!microphoneTrack && !microphoneTrack.isMuted;
  const camOn =
    !!cameraTrack &&
    cameraTrack.source === Track.Source.Camera &&
    !cameraTrack.isMuted;
  const screenShareOn = localParticipant.isScreenShareEnabled;
  const nativeScreenShare = getNativeScreenShareBridge();
  const browserScreenShareSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);
  const screenShareActive = screenShareOn || customScreenShareOn;
  const screenAudioAvailable = !nativeScreenShare;
  const canStartScreenShare = Boolean(nativeScreenShare || browserScreenShareSupported);

  useEffect(() => {
    if (!showShareDialog) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !shareStarting) {
        setShowShareDialog(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => {
      shareConfirmButtonRef.current?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [showShareDialog, shareStarting]);

  async function toggleMic() {
    await localParticipant.setMicrophoneEnabled(!micOn);
  }
  async function toggleCam() {
    await localParticipant.setCameraEnabled(!camOn);
  }
  async function handleShareScreen() {
    if (screenShareActive) {
      await stopShareScreen();
      return;
    }

    setShareError("");
    setShowMoreMenu(false);
    setShowReactions(false);
    setShowShareDialog(true);
  }

  async function stopShareScreen() {
    setShareError("");
    setShareStarting(false);

    const nativeShare = getNativeScreenShareBridge();
    if (nativeShare) {
      nativeShare.stopScreenShare();
      delete (window as unknown as NativeScreenShareWindow).onNativeScreenShareFrame;
    }

    if (customScreenShareTrackRef.current) {
      const track = customScreenShareTrackRef.current;
      track.stop();
      await localParticipant.unpublishTrack(track);
      customScreenShareTrackRef.current = null;
      setCustomScreenShareOn(false);
    }

    if (screenShareOn) {
      await localParticipant.setScreenShareEnabled(false);
    }
  }

  async function confirmShareScreen() {
    const nativeShare = getNativeScreenShareBridge();
    if (!nativeShare && !browserScreenShareSupported) {
      setShareError("Screen sharing is not available in this browser.");
      return;
    }

    setShareError("");
    setShareStarting(true);

    if (nativeShare) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 360;
        canvas.height = 640;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not create a screen share canvas.");
        }

        const firstFrame = waitForNativeScreenShareFrame(canvas, ctx);
        nativeShare.startScreenShare();
        await firstFrame;

        const stream = canvas.captureStream(8);
        const track = stream.getVideoTracks()[0];
        if (!track) {
          throw new Error("Could not create a native screen share track.");
        }
        customScreenShareTrackRef.current = track;
        track.addEventListener("ended", () => {
          customScreenShareTrackRef.current = null;
          setCustomScreenShareOn(false);
        });

        await localParticipant.publishTrack(track, {
          name: "screen",
          source: Track.Source.ScreenShare,
        });
        setCustomScreenShareOn(true);
        setShowShareDialog(false);
      } catch (e: unknown) {
        nativeShare.stopScreenShare();
        delete (window as unknown as NativeScreenShareWindow).onNativeScreenShareFrame;
        setShareError(`Failed to start native screen share: ${getShareErrorMessage(e)}`);
      } finally {
        setShareStarting(false);
      }
      return;
    }

    try {
      await localParticipant.setScreenShareEnabled(true, {
        audio: shareWithAudio,
        video: true,
        systemAudio: shareWithAudio ? "include" : "exclude",
        surfaceSwitching: "include",
        selfBrowserSurface: "include",
        contentHint: "detail",
      });
      setShowShareDialog(false);
    } catch (e: unknown) {
      setShareError(`Failed to start screen share: ${getShareErrorMessage(e)}`);
    } finally {
      setShareStarting(false);
    }
  }
  async function toggleRecording() {
    if (isLocalRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsLocalRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: true,
        // @ts-expect-error - preferCurrentTab is a relatively new API flag not in all TS definitions
        preferCurrentTab: true,
      });

      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      let recordedBlob: Blob | null = null;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        recordedBlob = new Blob(chunks, { type: "video/webm" });
        const filename = `orbit-recording-${room.name}-${Date.now()}.webm`;

        // Try File System Access API: showSaveFilePicker lets user pick save location
        try {
          // @ts-expect-error - File System Access API types from WICG spec
          const fileHandle = await window.showSaveFilePicker?.({
            suggestedName: filename,
            types: [{ description: 'WebM Video', accept: { 'video/webm': ['.webm'] } }],
          });
          if (fileHandle) {
            const writable = await (fileHandle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
            await writable.write(recordedBlob);
            await writable.close();
            stream.getTracks().forEach((t) => t.stop());
            setIsLocalRecording(false);
            return;
          }
        } catch (_saveErr: unknown) {
          if ((_saveErr as Error)?.name !== 'AbortError') {
            console.warn("showSaveFilePicker failed, falling back to download:", _saveErr);
          }
        }

        // Fallback: download via <a> tag
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.style.display = "none";
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        stream.getTracks().forEach((t) => t.stop());
        setIsLocalRecording(false);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsLocalRecording(true);

      // Stop recording if the user closes the screen share via the browser UI
      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert("Failed to start screen recording: " + msg);
      setIsLocalRecording(false);
    }
  }
  function toggleBreakout() {
    onToggleSidebar("breakout");
  }
  async function leave() {
    await room.disconnect();
    onLeave();
  }

  return (
    <div className="control-bar">
      {/* ——— Left: Audio / Video ——— */}
      <div className="control-bar-left">
        <MicButton
          micOn={micOn}
          toggleMic={toggleMic}
          microphoneTrack={microphoneTrack?.track as LocalAudioTrack | undefined}
        />
        <CtrlButton
          active={camOn}
          onClick={toggleCam}
          label="Video"
          icon={camOn ? <CamOnIcon /> : <CamOffIcon />}
          dataMobile="primary"
          hasCaret
        />
        <CtrlButton
          active={speakerMuted}
          onClick={onToggleSpeaker}
          label="Speaker"
          icon={speakerMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
          dataMobile="overflow"
        />
      </div>

      {/* ——— Center: Features ——— */}
      <div className="control-bar-center">
        <CtrlButton
          active={activeSidebar === "participants"}
          onClick={() => onToggleSidebar("participants")}
          label="People"
          icon={<ParticipantsIcon />}
          dataMobile="overflow"
          hasCaret
        />
        {/* Mobile "People" alias */}
        <CtrlButton
          active={activeSidebar === "participants"}
          onClick={() => onToggleSidebar("participants")}
          label="People"
          icon={<ParticipantsIcon />}
          dataMobile="primary-people"
        />
        <CtrlButton
          active={activeSidebar === "chat"}
          onClick={() => onToggleSidebar("chat")}
          label="Chat"
          icon={<ChatIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={screenShareActive}
          onClick={handleShareScreen}
          label={screenShareActive ? "Stop Share" : "Share"}
          icon={<ShareScreenIcon />}
          dataMobile="primary-share"
          hasCaret
          className="ctrl-share"
        />
        <CtrlButton
          active={activeSidebar === "translation"}
          onClick={() => onToggleSidebar("translation")}
          label="Translate"
          icon={<TranslateIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={isLocalRecording}
          onClick={toggleRecording}
          label="Record"
          icon={<RecordIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={activeSidebar === "breakout"}
          onClick={toggleBreakout}
          label="Breakout"
          icon={<BreakoutRoomsIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={showReactions || handRaised}
          onClick={() => setShowReactions((v) => !v)}
          label="React"
          icon={<HandRaiseIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={showInviteDialog}
          onClick={openInvite}
          label="Invite"
          icon={<InviteIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={false}
          onClick={() => router.push("/settings")}
          label="Settings"
          icon={<SettingsIcon />}
          dataMobile="overflow"
        />
        <CtrlButton
          active={false}
          onClick={() => router.push("/history")}
          label="History"
          icon={<HistoryIcon />}
          dataMobile="overflow"
        />
      </div>

      {/* ——— Right: Leave & More ——— */}
      <div className="control-bar-right">
        <button
          className="ctrl ctrl--warning ctrl-leave ctrl-desktop-leave"
          onClick={leave}
          title="Leave the call"
          aria-label="Leave"
        >
          Leave
        </button>
        {/* Mobile only */}
        <CtrlButton
          active={showMoreMenu}
          onClick={() => setShowMoreMenu((v) => !v)}
          label="More"
          icon={<MoreIcon />}
          dataMobile="more"
        />
      </div>

      {/* ——— Mobile "More" Menu ——— */}
      {showMoreMenu && (
        <div className="mobile-more-overlay" onClick={() => setShowMoreMenu(false)}>
          <div
            className="mobile-more-menu"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="More meeting options"
          >
            <div className="mobile-more-header">
              <h3>More Options</h3>
              <button className="mobile-more-close" onClick={() => setShowMoreMenu(false)} title="Close menu" aria-label="Close menu">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div className="mobile-more-content">
              <button className="mobile-more-item" onClick={() => { onToggleSidebar("chat"); setShowMoreMenu(false); }}>
                <ChatIcon /> <span>Chat</span>
              </button>
              <button className="mobile-more-item" onClick={() => { onToggleSidebar("translation"); setShowMoreMenu(false); }}>
                <TranslateIcon /> <span>Translate</span>
              </button>
              <button className="mobile-more-item" onClick={() => { onToggleSidebar("captions"); setShowMoreMenu(false); }}>
                <CaptionsIcon /> <span>Captions</span>
              </button>
              <button className="mobile-more-item" onClick={() => { toggleRecording(); setShowMoreMenu(false); }}>
                <RecordIcon /> <span>{isLocalRecording ? "Stop Recording" : "Record"}</span>
              </button>
              <button className="mobile-more-item" onClick={() => { toggleBreakout(); setShowMoreMenu(false); }}>
                <BreakoutRoomsIcon /> <span>Breakout</span>
              </button>
              <button className="mobile-more-item" onClick={() => { onToggleSpeaker(); setShowMoreMenu(false); }}>
                {speakerMuted ? <SpeakerOffIcon /> : <SpeakerIcon />} <span>Speaker</span>
              </button>
              <button className="mobile-more-item" onClick={() => { openInvite(); }}>
                <InviteIcon /> <span>Invite</span>
              </button>
              <button className="mobile-more-item" onClick={() => { router.push("/settings"); setShowMoreMenu(false); }}>
                <SettingsIcon /> <span>Settings</span>
              </button>
              <button className="mobile-more-item" onClick={() => { router.push("/history"); setShowMoreMenu(false); }}>
                <HistoryIcon /> <span>History</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reaction picker */}
      {showReactions && (
        <div className="reaction-picker">
          {REACTIONS.map((r) => (
            <button key={r} className="reaction-btn" onClick={() => { sendReaction(r); setShowReactions(false); }}>
              {r}
            </button>
          ))}
        </div>
      )}

      {/* ——— Invite Dialog ——— */}
      {showInviteDialog && mounted && createPortal(
        <div
          className="share-dialog-overlay"
          onClick={() => setShowInviteDialog(false)}
        >
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="share-dialog-header">
              <span className="share-dialog-icon" aria-hidden>
                <InviteIcon />
              </span>
              <div>
                <h3 className="share-dialog-title" id="invite-dialog-title">Invite people</h3>
                <p className="share-dialog-desc">
                  Share the meeting link to invite others.
                </p>
              </div>
              <button
                type="button"
                className="share-dialog-close"
                onClick={() => setShowInviteDialog(false)}
                aria-label="Close invite dialog"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            <div className="invite-dialog-bar">
              <span className="invite-dialog-link">{window.location.href}</span>
              <button
                type="button"
                className="invite-dialog-copy"
                onClick={copyMeetingLink}
                aria-label={inviteCopied ? "Copied" : "Copy meeting link"}
              >
                {inviteCopied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="invite-dialog-share">
              <button
                type="button"
                className="invite-share-btn invite-share-email"
                onClick={() => { window.location.href = getEmailLink(); }}
                title="Share via Email"
                aria-label="Share via Email"
              >
                <MailIcon />
                <span>Email</span>
              </button>
              <button
                type="button"
                className="invite-share-btn invite-share-gmail"
                onClick={() => { window.open(getGmailLink(), "_blank", "noopener,noreferrer"); }}
                title="Share via Gmail"
                aria-label="Share via Gmail"
              >
                <GmailIcon />
                <span>Gmail</span>
              </button>
              <button
                type="button"
                className="invite-share-btn invite-share-whatsapp"
                onClick={() => { window.open(getWhatsAppLink(), "_blank", "noopener,noreferrer"); }}
                title="Share via WhatsApp"
                aria-label="Share via WhatsApp"
              >
                <WhatsAppIcon />
                <span>WhatsApp</span>
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {/* ——— Share Screen Dialog ——— */}
      {showShareDialog && mounted && createPortal(
        <div
          className="share-dialog-overlay"
          onClick={() => {
            if (!shareStarting) setShowShareDialog(false);
          }}
        >
          <section
            className="share-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            aria-describedby="share-dialog-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="share-dialog-header">
              <span className="share-dialog-icon" aria-hidden>
                <ShareScreenIcon />
              </span>
              <div>
                <h3 className="share-dialog-title" id="share-dialog-title">Share screen</h3>
                <p className="share-dialog-desc" id="share-dialog-desc">
                  Start a screen share for this meeting.
                </p>
              </div>
              <button
                type="button"
                className="share-dialog-close"
                onClick={() => setShowShareDialog(false)}
                disabled={shareStarting}
                aria-label="Close share screen dialog"
              >
                <span aria-hidden>×</span>
              </button>
            </div>

            {!canStartScreenShare && (
              <div className="share-dialog-error" role="status">
                Screen sharing is not available in this browser.
              </div>
            )}

            {shareError && (
              <div className="share-dialog-error" role="alert">
                {shareError}
              </div>
            )}

            <label className={`share-dialog-option${screenAudioAvailable ? "" : " share-dialog-option--disabled"}`}>
              <span className="share-dialog-option-icon">
                <SpeakerIcon />
              </span>
              <span className="share-dialog-option-text">
                <strong>Computer sound</strong>
                <small>{screenAudioAvailable ? "Include system audio when supported" : "Not available for this share mode"}</small>
              </span>
              <input
                type="checkbox"
                checked={screenAudioAvailable && shareWithAudio}
                onChange={(e) => setShareWithAudio(e.target.checked)}
                disabled={!screenAudioAvailable || shareStarting}
                aria-label="Share computer sound"
              />
            </label>

            <div className="share-dialog-actions">
              <button
                type="button"
                className="share-dialog-btn share-dialog-btn-cancel"
                disabled={shareStarting}
                onClick={() => setShowShareDialog(false)}
              >
                Cancel
              </button>
              <button
                ref={shareConfirmButtonRef}
                type="button"
                className="share-dialog-btn share-dialog-btn-confirm"
                disabled={shareStarting || !canStartScreenShare}
                onClick={confirmShareScreen}
              >
                {shareStarting ? "Starting..." : "Share"}
              </button>
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}

function MicButton({
  micOn,
  toggleMic,
  microphoneTrack,
}: {
  micOn: boolean;
  toggleMic: () => void;
  microphoneTrack?: LocalAudioTrack;
}) {
  const volume = useTrackVolume(microphoneTrack);
  const isSpeaking = micOn && volume > 0.05;
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty('--volume-opacity', isSpeaking ? String(Math.min(0.8, volume * 2)) : '0');
      wrapperRef.current.style.setProperty('--volume-scale', isSpeaking ? String(1 + (volume * 0.5)) : '1');
    }
  }, [isSpeaking, volume]);

  return (
    <div ref={wrapperRef} className="mic-btn-wrapper">
      <CtrlButton
        active={micOn}
        onClick={toggleMic}
        label={micOn ? "Mute" : "Unmute"}
        icon={micOn ? <MicOnIcon /> : <MicOffIcon />}
        dataMobile="primary"
        muted={!micOn}
        hasCaret
        className="mic-btn"
      />
    </div>
  );
}

function MailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.012 2c-5.506 0-9.988 4.482-9.988 9.988 0 1.76.456 3.474 1.32 4.98L2 22l5.166-1.356a9.92 9.92 0 0 0 4.846 1.258h.004c5.504 0 9.986-4.482 9.986-9.988C22 6.482 17.518 2 12.012 2zm5.782 14.168c-.246.696-1.428 1.374-1.968 1.464-.492.084-1.134.12-1.8.12-2.796 0-5.832-1.638-7.728-4.296-1.122-1.572-1.92-3.468-1.92-5.466 0-1.848.882-2.82 1.698-3.084.246-.084.498-.12.75-.12.246 0 .498.012.678.024.192.012.456-.072.714.54.258.624.882 2.148.96 2.304.078.156.132.336.024.54-.108.204-.204.348-.36.528-.156.18-.324.396-.462.528-.156.156-.324.324-.138.636.18.3.804 1.326 1.722 2.142.924.822 1.704 1.38 2.022 1.542.318.156.498.132.684-.084.186-.216.792-.924.996-1.236.21-.312.414-.258.696-.156.282.102 1.782.84 2.088.996.3.156.504.228.576.36.072.132.072.756-.174 1.452z" />
    </svg>
  );
}

function CtrlButton({
  active,
  onClick,
  label,
  icon,
  dataMobile,
  hasCaret,
  muted,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  dataMobile?: string;
  hasCaret?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`ctrl${active ? " ctrl--active" : ""}${muted ? " ctrl--muted" : ""} ${className}`.trim()}
      onClick={onClick}
      title={label}
      aria-label={label}
      data-mobile={dataMobile}
    >
      <span className="ctrl-icon-row">
        <span className="ctrl-icon">{icon}</span>
        {hasCaret && <span className="ctrl-caret"><CaretUpIcon /></span>}
      </span>
      <span className="ctrl-label">{label}</span>
    </button>
  );
}
