const invitationId = location.pathname.split("/").pop();
let callId = null;

const consent = document.getElementById("consent");
const join = document.getElementById("join");
const endBtn = document.getElementById("end");
const video = document.getElementById("local");

join.disabled = true;

consent.addEventListener("change", () => {
  join.disabled = !consent.checked;
});

async function init() {
  try {
    const info = await HandCheck.api(`/api/calls/for-invitation/${invitationId}`);
    callId = info.callId;
    const me = await HandCheck.api("/api/me");
    const hasConsent =
      (me.role === "candidate" && info.consentCandidate) ||
      (me.role === "employer" && info.consentEmployer);
    if (hasConsent) {
      consent.checked = true;
      join.disabled = false;
    }
  } catch {
    join.disabled = !consent.checked;
  }
}

join.onclick = async () => {
  if (!consent.checked || join.disabled) return;
  await HandCheck.api(`/api/calls/${callId}/consent`, {
    method: "POST",
    body: JSON.stringify({ accepted: true }),
  });
  await HandCheck.api(`/api/calls/${callId}/start`, { method: "POST" });
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  video.srcObject = stream;
  video.classList.add("live");
  join.hidden = true;
  endBtn.hidden = false;
};

endBtn.onclick = async () => {
  await HandCheck.api(`/api/calls/${callId}/end`, { method: "POST" });
  location.href = "/";
};

init();
