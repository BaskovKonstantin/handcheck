/* global HandCheck */
"use strict";

(function (global) {
  const WS_SIGNAL = { OFFER: "offer", ANSWER: "answer", ICE: "ice", ENDED: "ended" };

  function wsUrl(callId) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws/calls/${callId}`;
  }

  function parseSignal(raw) {
    try {
      const msg = JSON.parse(raw);
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

  /**
   * @param {object} opts
   * @param {string} opts.callId
   * @param {string} opts.role - employer | candidate
   * @param {() => void} [opts.onPeerEnded]
   * @param {(state: object) => void} [opts.onState]
   */
  function createCallSession(opts) {
    const { callId, role, onPeerEnded, onState } = opts;
    let ws = null;
    let pc = null;
    let localStream = null;
    let remoteStream = null;
    let recorder = null;
    let recorderChunks = [];
    let speech = null;
    let speechNoteShown = false;
    let pollTimer = null;
    let ended = false;

    let recordingHasData = false;
    let transcriptWarn = "";

    function emit(patch) {
      if (typeof onState === "function") {
        onState({
          peerConnected: Boolean(remoteStream?.getTracks?.().some((t) => t.readyState === "live")),
          recording: Boolean(recorder && recorder.state === "recording" && recordingHasData),
          speechAvailable: Boolean(speech),
          speechNote: speechNoteShown ? "Расшифровка недоступна в этом браузере" : "",
          transcriptWarn,
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
      ws.onmessage = async (ev) => {
        let raw = ev.data;
        if (typeof Blob !== "undefined" && raw instanceof Blob) {
          raw = await raw.text();
        } else if (raw instanceof ArrayBuffer) {
          raw = new TextDecoder().decode(raw);
        } else if (typeof raw !== "string") {
          raw = String(raw);
        }
        const msg = parseSignal(raw);
        if (msg) handleSignal(msg);
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
        for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
          const res = ev.results[i];
          if (!res.isFinal) continue;
          const text = String(res[0]?.transcript || "").trim();
          if (!text) continue;
          HandCheck.api(`/api/calls/${callId}/transcript-chunk`, {
            method: "POST",
            body: JSON.stringify({ text }),
          }).catch(() => {
            transcriptWarn = "Не удалось сохранить реплику — проверьте соединение";
            emit({});
          });
        }
      };
      speech.onerror = () => {
        speechNoteShown = true;
        emit({});
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
      recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recorderChunks.push(ev.data);
          if (!recordingHasData) {
            recordingHasData = true;
            emit({ recording: true });
          }
        }
      };
      recorder.start(1000);
      emit({ recording: false });
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
        throw new Error(err?.error || `recording_upload_${res.status}`);
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
      async attachLocalMedia(stream) {
        localStream = stream;
        if (pc) {
          stream.getTracks().forEach((tr) => pc.addTrack(tr, stream));
        }
      },
      async enterLive(invitationId) {
        await connectSignaling();
        startRecorder(localStream);
        startSpeechRecognition();
        startStatusPoll((info) => {
          if (typeof onPeerEnded === "function") onPeerEnded(info);
        });
        opts.invitationId = invitationId;
        emit({});
      },
      async endLocalSide() {
        ended = true;
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
        try {
          await uploadRecording();
        } catch (err) {
          emit({ recordingUploadError: err?.message || "upload_failed" });
          throw err;
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
    _WS_SIGNAL: WS_SIGNAL,
  };
})(window);
