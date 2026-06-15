"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { PICKER_LANGUAGES, getLanguageByCode } from "@/lib/languages";
import { useTextStream, useRemoteParticipants, useLocalParticipant, useDataChannel } from "@livekit/components-react";
import { SpeakerIcon, SpeakerOffIcon } from "./icons";
import { saveHistory, uploadHistoryToSupabase, type TranslationHistoryEntry } from "@/lib/translationHistory";

interface Entry {
  key: string;
  sourceIdentity: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string | undefined;
  isFinal: boolean;
}

const VOICES = [
  { id: "male1", name: "Male 1" },
  { id: "male2", name: "Male 2" },
  { id: "female1", name: "Female 1" },
  { id: "female2", name: "Female 2" },
];

const TRANSLATION_TOPIC = "lk.translation";

export default function OrbitTranslationPanel({
  onClose,
  myLang,
  onLangChange,
  translatorMuted,
  onToggleTranslator,
  peerLangs,
  roomName,
}: {
  onClose: () => void;
  myLang: string;
  onLangChange: (lang: string) => void;
  translatorMuted: boolean;
  onToggleTranslator: () => void;
  peerLangs: Map<string, string | undefined>;
  roomName: string;
}) {
  const [voice, setVoice] = useState("male1");
  const { textStreams } = useTextStream(TRANSLATION_TOPIC);
  const remotes = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();
  const sourceBodyRef = useRef<HTMLDivElement | null>(null);
  const translatedBodyRef = useRef<HTMLDivElement | null>(null);

  const [adjustingEntry, setAdjustingEntry] = useState<{
    key: string;
    text: string;
    sourceText: string;
  } | null>(null);

  const [retranslations, setRetranslations] = useState<Record<string, string>>({});

  const TONE_OPTIONS = [
    { id: "formal", label: "Formal", emoji: "👔" },
    { id: "casual", label: "Casual", emoji: "😊" },
    { id: "slang", label: "Slang", emoji: "🤪" },
    { id: "simple", label: "Simple (ELI5)", emoji: "👶" },
  ];

  useDataChannel("retranslation_response", (msg) => {
    try {
      const decoder = new TextDecoder();
      const payload = JSON.parse(decoder.decode(msg.payload));
      if (payload.key && payload.text) {
        setRetranslations((prev) => ({
          ...prev,
          [payload.key]: payload.text,
        }));
      }
    } catch (e) {
      console.error("Failed to parse retranslation response:", e);
    }
  });

  const requestRetranslation = (entry: Entry, tone: string) => {
    const payload = {
      key: entry.key,
      sourceText: entry.sourceText || entry.translatedText,
      target_lang: myLang,
      adjustment: tone,
    };

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    localParticipant.publishData(data, {
      topic: "retranslation_request",
      reliable: true,
    });
    setAdjustingEntry(null);
  };

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of remotes) {
      map.set(p.identity, p.name || p.identity);
    }
    return map;
  }, [remotes]);

  const entries = useMemo(() => {
    const matching = textStreams
      .filter((s) => s.streamInfo.attributes?.target_lang === myLang)
      .sort((a, b) => a.streamInfo.timestamp - b.streamInfo.timestamp);

    const out: Entry[] = [];
    const openIdxBySource = new Map<string, number>();

    for (const s of matching) {
      const source = s.streamInfo.attributes?.source_identity ?? s.participantInfo.identity;
      const isSource = s.streamInfo.attributes?.kind === "source";
      const isFinal = s.streamInfo.attributes?.final === "true";
      const text = s.text.trim();

      if (!text) {
        if (isFinal) {
          const openIdx = openIdxBySource.get(source);
          if (openIdx !== undefined) {
            out[openIdx].isFinal = true;
          }
          openIdxBySource.delete(source);
        }
        continue;
      }

      const openIdx = openIdxBySource.get(source);
      if (openIdx !== undefined) {
        // Append to open entry
        if (isSource) {
          out[openIdx].sourceText = `${out[openIdx].sourceText} ${text}`.trim();
        } else {
          out[openIdx].translatedText = `${out[openIdx].translatedText} ${text}`.trim();
        }
        if (isFinal) out[openIdx].isFinal = true;
      } else {
        // New entry
        out.push({
          key: `entry-${out.length}`,
          sourceIdentity: source,
          sourceText: isSource ? text : "",
          translatedText: isSource ? "" : text,
          sourceLang: peerLangs.get(source),
          isFinal: isFinal,
        });
        openIdxBySource.set(source, out.length - 1);
      }

      if (isFinal) openIdxBySource.delete(source);
    }
    return out.map((entry) => {
      if (retranslations[entry.key]) {
        return { ...entry, translatedText: retranslations[entry.key] };
      }
      return entry;
    });
  }, [textStreams, myLang, peerLangs, retranslations]);

  useEffect(() => {
    if (!sourceBodyRef.current) return;
    sourceBodyRef.current.scrollTop = sourceBodyRef.current.scrollHeight;
  }, [entries]);

  useEffect(() => {
    if (!translatedBodyRef.current) return;
    translatedBodyRef.current.scrollTop = translatedBodyRef.current.scrollHeight;
  }, [entries]);

  // ── Capture finalized entries to history ──
  const savedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Only capture entries that have both source and translation
    const newEntries: TranslationHistoryEntry[] = [];
    for (const entry of entries) {
      if (savedKeysRef.current.has(entry.key)) continue;
      // Only capture when the turn is actually finalized
      if (!entry.isFinal) continue;
      if (!entry.sourceText || !entry.translatedText) continue;

      const userId =
        (typeof window !== "undefined"
          ? localStorage.getItem("orbitUserId")
          : null) ?? "";

      const historyEntry: TranslationHistoryEntry = {
        id: `${roomName}-${entry.key}-${Date.now()}`,
        user_id: userId,
        room_name: roomName,
        source_identity: entry.sourceIdentity,
        speaker_name: names.get(entry.sourceIdentity) ?? entry.sourceIdentity,
        source_text: entry.sourceText,
        translated_text: entry.translatedText,
        source_lang: entry.sourceLang ?? "",
        target_lang: myLang,
        created_at: new Date().toISOString(),
      };

      newEntries.push(historyEntry);
      savedKeysRef.current.add(entry.key);
    }

    if (newEntries.length > 0) {
      saveHistory(newEntries);
      uploadHistoryToSupabase(newEntries);
    }
  }, [entries, names, myLang, roomName]);

  const sourceEntries = entries.filter((e) => e.sourceText);
  const translatedEntries = entries.filter((e) => e.translatedText);

  return (
    <div className="sidebar-panel">
      <div className="sidebar-header otp-header-row">
        <select
          value={myLang}
          onChange={(e) => onLangChange(e.target.value)}
          className="otp-header-select"
          aria-label="Target language"
        >
          {PICKER_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.flag} {l.name}
            </option>
          ))}
        </select>

        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="otp-header-select"
          aria-label="Voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <button
          className="otp-speaker-toggle"
          onClick={onToggleTranslator}
          title={translatorMuted ? "Unmute translator" : "Mute translator"}
          aria-label={translatorMuted ? "Unmute translator" : "Mute translator"}
        >
          {translatorMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
        </button>

        <button className="sidebar-close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="sidebar-body otp-split-body">
        {/* Upper Area: Original Transcription */}
        <div className="otp-section-header">Original Transcription</div>
        <div ref={sourceBodyRef} className="otp-scroll-area otp-scroll-area--source">
          {sourceEntries.length === 0 ? (
            <div className="captions-empty">
              
            </div>
          ) : (
            sourceEntries.map((entry) => (
              <div className="captions-entry" key={entry.key}>
                <p className="captions-text">
                  <strong>{names.get(entry.sourceIdentity) ?? entry.sourceIdentity}:</strong>{" "}
                  {entry.sourceText}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Divider */}
        <div className="otp-split-divider" />

        {/* Lower Area: Translated Output */}
        <div className="otp-section-header">Translated Output</div>
        <div ref={translatedBodyRef} className="otp-scroll-area otp-scroll-area--translated">
          {translatedEntries.length === 0 ? (
            <div className="captions-empty">
              
            </div>
          ) : (
            translatedEntries.map((entry) => (
              <div 
                className="captions-entry" 
                key={entry.key}
                onDoubleClick={() => setAdjustingEntry({ key: entry.key, text: entry.translatedText, sourceText: entry.sourceText })}
                title="Double click to change tone / re-translate"
              >
                {entry.sourceLang && (
                  <div className="captions-speaker">
                    <span className="captions-speaker-lang">
                      {getLanguageByCode(entry.sourceLang)?.name || entry.sourceLang} → {getLanguageByCode(myLang)?.name || myLang}
                    </span>
                  </div>
                )}
                <p className="captions-text captions-text--translated">
                  <strong>Orbit Translator:</strong> {entry.translatedText}
                </p>
                {adjustingEntry?.key === entry.key && (
                  <div className="retranslate-dialog" onClick={(e) => e.stopPropagation()}>
                    <div className="retranslate-header">Change Tone / Re-translate</div>
                    <div className="retranslate-options">
                      {TONE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          className="retranslate-btn"
                          onClick={() => requestRetranslation(entry, opt.id)}
                        >
                          {opt.emoji} {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="retranslate-custom-row">
                      <input
                        type="text"
                        placeholder="Custom tone (e.g. formal, excited)"
                        className="retranslate-input"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value.trim()) {
                            requestRetranslation(entry, e.currentTarget.value.trim());
                          }
                        }}
                      />
                      <button 
                        className="retranslate-cancel-btn"
                        onClick={() => setAdjustingEntry(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
