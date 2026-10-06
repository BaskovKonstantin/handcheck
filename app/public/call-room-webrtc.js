/* global HandCheck */
"use strict";

(function (global) {
  const WS_SIGNAL = { OFFER: "offer", ANSWER: "answer", ICE: "ice", ENDED: "ended" };

  /** Target total bitrate so ~60 min fits in 80 MB upload limit (with headroom). */
  const RECORDING_LIMIT_BYTES = 80 * 1024 * 1024;
  const RECORDING_TARGET_SECONDS = 60 * 60;
  const RECORDER_VIDEO_BPS = 130_000;
  const RECORDER_AUDIO_BPS = 20_000;
  const RECORDER_TOTAL_BPS = RECORDER_VIDEO_BPS + RECORDER_AUDIO_BPS;

  function wsUrl(callId) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/calls/${callId}`;
  }

  async function parseSignal(raw) {
    let text = raw;
    if (typeof raw !== "string") {
      if (raw instanceof Blob) {
        text = await raw.text();
      } else if (raw instanceof ArrayBuffer) {
        text = new TextDecoder().decode(raw);
      } else if (raw && typeof raw.byteLength === "number") {
        text = new TextDecoder().decode(new Uint8Array(raw));
      } else {
        text = String(raw);
      }
    }
    try {
      const msg = JSON.parse(text);
      if (msg && typeof msg.t === "string") return msg;
    } catch {
      /* ignore */
    }
    return null;
  }

  function pickRecorderMime() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  }

  function recorderFitsPlanLimit() {
    const bytesPerSecond = RECORDER_TOTAL_BPS / 8;
    const projected = bytesPerSecond * RECORDING_TARGET_SECONDS;
    return projected <= RECORDING_LIMIT_BYTES * 0.92;
  }

  /**
   * @param {object} opts
   * @param {string} opts.callId
   * @param {string} opts.role - employer | candidate
   * @param {() => void} [opts.onPeerEnded]
   * @param {(state: object) => void} [opts.onState]
   * @param {(message: string) => void} [opts.onUploadError]
   */
  function createCallSession(opts) {
    const { callId, role, onPeerEnded, onState, onUploadError } = opts;
    let ws = null;
    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let recorder = null;
    let recorderChunks = [];
    let speech = null;
    let speechNoteShown = false;
    let speechStopped = false;
    let pollTimer = null;
    let ended = false;
    let liveFeaturesStarted = false;
    let liveStartedAt = null;

    function emit(patch) {
      if (typeof onState === "function") {
        onState({
          peerConnected: Boolean(remoteStream?.getTracks?.().some((t) => t.readyState === "live")),
          recording: Boolean(recorder && recorder.state === "recording"),
          speechAvailable: Boolean(speech),
          speechNote: speechNoteShown ? "Расшифровка недоступна в этом браузере" : "",
          ...patch,
        });
      }
    }

    function sendSignal(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    }

    async function ensurePeerConnection() {
      if (pc) return pc;
      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pc.onicecandidate = (ev) => {
        if (ev.candidate) sendSignal({ t: WS_SIGNAL.ICE, candidate: ev.candidate });
      };
      pc.ontrack = (ev) => {
        if (!remoteStream) remoteStream = new MediaStream();
        ev.streams[0]?.getTracks().forEach((tr) => {
          if (!remoteStream.getTracks().some((x) => x.id === tr.id)) remoteStream.addTrack(tr);
        });
        emit({});
      };
      pc.onconnectionstatechange = () => emit({ connectionState: pc.connectionState });
      if (localStream) {
        localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream));
      }
      return pc;
    }

    async function handleSignal(msg) {
      if (!msg || ended) return;
      const conn = await ensurePeerConnection();
      if (msg.t === WS_SIGNAL.OFFER && role === "candidate") {
        await conn.setRemoteDescription(msg.sdp);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        sendSignal({ t: WS_SIGNAL.ANSWER, sdp: conn.localDescription });
      } else if (msg.t === WS_SIGNAL.ANSWER && role === "employer") {
        await conn.setRemoteDescription(msg.sdp);
      } else if (msg.t === WS_SIGNAL.ICE && msg.candidate) {
        try {
          await conn.addIceCandidate(msg.candidate);
        } catch {
          /* ignore stale ice */
        }
      } else if (msg.t === WS_SIGNAL.ENDED) {
        ended = true;
        if (typeof onPeerEnded === "function") onPeerEnded();
      }
    }

    let offerRetryTimer = null;

    async function sendOffer() {
      if (role !== "employer" || ended) return;
      const conn = await ensurePeerConnection();
      if (conn.connectionState === "connected") return;
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      sendSignal({ t: WS_SIGNAL.OFFER, sdp: conn.localDescription });
    }

    async function connectSignaling() {
      if (ws) return;
      ws = new WebSocket(wsUrl(callId));
      ws.onmessage = (ev) => {
        parseSignal(ev.data).then((msg) => {
          if (msg) handleSignal(msg);
        });
      };
      ws.onopen = async () => {
        emit({ wsOpen: true });
        if (role === "employer") {
          await sendOffer();
          clearInterval(offerRetryTimer);
          offerRetryTimer = setInterval(() => {
            if (remoteStream?.getTracks?.().some((t) => t.readyState === "live")) {
              clearInterval(offerRetryTimer);
              return;
            }
            sendOffer().catch(() => {});
          }, 1500);
        }
      };
    }

    function restartSpeech() {
      if (ended || speechStopped || !speech) return;
      try {
        speech.start();
      } catch {
        speechNoteShown = true;
        speech = null;
        emit({});
      }
    }

    function startSpeechRecognition() {
      const Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!Ctor) {
        speechNoteShown = true;
        emit({});
        return;
      }
      speech = new Ctor();
      speech.lang = "ru-RU";
      speech.continuous = true;
      speech.interimResults = false;
      speech.onresult = (ev) => {
        const at =
          liveStartedAt != null ? Math.max(0, Math.round((Date.now() - liveStartedAt) / 1000)) : 0;
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const res = ev.results[i];
          if (!res.isFinal) continue;
          const text = String(res[0]?.transcript || "").trim();
          if (!text) continue;
          HandCheck.api(`/api/calls/${callId}/transcript-chunk`, {
            method: "POST",
            body: JSON.stringify({ text, at }),
          }).catch(() => {});
        }
      };
      speech.onerror = (ev) => {
        if (ended || speechStopped) return;
        const code = ev?.error || "";
        if (code === "network" || code === "aborted" || code === "no-speech") {
          setTimeout(() => restartSpeech(), 300);
          return;
        }
        speechNoteShown = true;
        emit({});
      };
      speech.onend = () => {
        if (!ended && !speechStopped) restartSpeech();
      };
      try {
        speech.start();
      } catch {
        speechNoteShown = true;
        speech = null;
      }
      emit({});
    }

    function startRecorder(stream) {
      const mime = pickRecorderMime();
      if (!mime || typeof MediaRecorder === "undefined") {
        emit({ recording: false, recordingUnavailable: true });
        return;
      }
      recorderChunks = [];
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: RECORDER_VIDEO_BPS,
        audioBitsPerSecond: RECORDER_AUDIO_BPS,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recorderChunks.push(ev.data);
      };
      recorder.start(1000);
      emit({ recording: true });
    }

    async function uploadRecording() {
      if (!recorderChunks.length) return;
      const mime = pickRecorderMime() || "video/webm";
      const blob = new Blob(recorderChunks, { type: mime });
      if (!blob.size) return;
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch(`/api/calls/${callId}/recording`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const code = err?.error || `recording_upload_${res.status}`;
        const message =
          res.status === 413
            ? "Запись слишком большая (максимум 80 МБ). Сократите звонок или обратитесь в поддержку."
            : HandCheck.formatApiError?.({ data: err, message: code }) || "Не удалось сохранить запись";
        if (typeof onUploadError === "function") onUploadError(message);
        throw new Error(code);
      }
    }

    function startStatusPoll(onEndedRemote) {
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        if (ended) return;
        try {
          const info = await HandCheck.api(`/api/calls/for-invitation/${opts.invitationId}`);
          if (info.status === "ended") {
            ended = true;
            if (typeof onEndedRemote === "function") onEndedRemote(info);
          }
        } catch {
          /* ignore */
        }
      }, 2500);
    }

    return {
      getLocalStream: () => localStream,
      getRemoteStream: () => remoteStream,
      getConnectionState: () => pc?.connectionState || "new",
      async attachLocalMedia(stream) {
        localStream = stream;
        if (pc) {
          stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
        }
      },
      async connectSignaling() {
        await connectSignaling();
      },
      async startLiveFeatures() {
        if (liveFeaturesStarted) return;
        liveFeaturesStarted = true;
        liveStartedAt = Date.now();
        startRecorder(localStream);
        startSpeechRecognition();
        startStatusPoll((info) => {
          if (typeof onPeerEnded === "function") onPeerEnded(info);
        });
        emit({});
      },
      async endLocalSide(options = {}) {
        const { skipUpload = false } = options;
        ended = true;
        speechStopped = true;
        sendSignal({ t: WS_SIGNAL.ENDED });
        clearInterval(pollTimer);
        clearInterval(offerRetryTimer);
        if (speech) {
          try {
            speech.stop();
          } catch {
            /* ignore */
          }
          speech = null;
        }
        if (recorder && recorder.state !== "inactive") {
          await new Promise((resolve) => {
            recorder.onstop = () => resolve();
            recorder.stop();
          });
        }
        if (!skipUpload && liveFeaturesStarted) {
          await uploadRecording();
        }
        if (ws) {
          ws.close();
          ws = null;
        }
        if (pc) {
          pc.close();
          pc = null;
        }
        if (localStream) {
          localStream.getTracks().forEach((t) => t.stop());
          localStream = null;
        }
        emit({ recording: false });
      },
      notifyPeerEnded() {
        sendSignal({ t: WS_SIGNAL.ENDED });
      },
    };
  }

  global.HandCheckCallRoom = {
    createCallSession,
    pickRecorderMime,
    parseSignal,
    recorderFitsPlanLimit,
    RECORDER_TOTAL_BPS,
    RECORDING_LIMIT_BYTES,
    RECORDING_TARGET_SECONDS,
    _WS_SIGNAL: WS_SIGNAL,
  };
})(window);
