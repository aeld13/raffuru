(() => {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const generatedLinks = [];
  let revealPayload = null;
  let toastTimer = null;

  const $ = (selector) => document.querySelector(selector);

  const organizerView = $("#organizer-view");
  const participantView = $("#participant-view");
  const form = $("#draw-form");
  const namesInput = $("#names");
  const eventInput = $("#event-name");
  const nameCount = $("#name-count");
  const formError = $("#form-error");
  const results = $("#results");
  const linkList = $("#link-list");
  const toast = $("#toast");

  function parseNames(value) {
    return value
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function validateNames(names) {
    if (names.length < 2) return "Add at least two people.";
    if (names.length > 100) return "Keep this draw to 100 people or fewer.";

    const seen = new Set();
    for (const name of names) {
      if (name.length > 80) return `“${name.slice(0, 24)}…” is too long.`;
      const normalized = name.toLocaleLowerCase();
      if (seen.has(normalized)) return `“${name}” appears more than once.`;
      seen.add(normalized);
    }
    return "";
  }

  function secureRandomInt(maxExclusive) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive safe integer");
    }
    const ceiling = 0x100000000;
    const limit = ceiling - (ceiling % maxExclusive);
    const buffer = new Uint32Array(1);
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % maxExclusive;
  }

  function secureShuffle(values) {
    const shuffled = [...values];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = secureRandomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function verifyCircle(circle) {
    const assignments = new Map(
      circle.map((giver, index) => [giver, circle[(index + 1) % circle.length]])
    );
    const uniqueRecipients = new Set(assignments.values()).size;
    const selfMatches = [...assignments].filter(([giver, recipient]) => giver === recipient).length;
    const visited = new Set();
    let current = circle[0];
    for (let i = 0; i < circle.length; i += 1) {
      if (visited.has(current)) break;
      visited.add(current);
      current = assignments.get(current);
    }
    const completeCircle = visited.size === circle.length && current === circle[0];
    const passed =
      assignments.size === circle.length &&
      uniqueRecipients === circle.length &&
      selfMatches === 0 &&
      completeCircle;

    return {
      participants: circle.length,
      uniqueRecipients,
      selfMatches,
      completeCircle,
      passed,
    };
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + padding;
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function createPrivateLink(payload) {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 128 },
      true,
      ["encrypt", "decrypt"]
    );
    // Every link receives a new random key, so a fixed IV is never reused with a key.
    // Omitting a transmitted IV makes the static private links substantially shorter.
    const iv = new Uint8Array(12);
    const cleartext = encoder.encode(JSON.stringify([payload.from, payload.to, payload.event]));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, cleartext)
    );
    const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    const baseUrl = `${location.origin}${location.pathname}${location.search}`;
    const fragment = [
      "sc2",
      bytesToBase64Url(rawKey),
      bytesToBase64Url(ciphertext),
    ].join(".");
    return `${baseUrl}#${fragment}`;
  }

  async function decryptFragment(fragment) {
    const parts = fragment.replace(/^#/, "").split(".");
    const legacy = parts[0] === "sc1" && parts.length === 4;
    const compact = parts[0] === "sc2" && parts.length === 3;
    if (!legacy && !compact) throw new Error("Invalid link");

    const iv = legacy ? base64UrlToBytes(parts[1]) : new Uint8Array(12);
    const rawKey = base64UrlToBytes(parts[legacy ? 2 : 1]);
    const ciphertext = base64UrlToBytes(parts[legacy ? 3 : 2]);
    const expectedKeyLength = legacy ? 32 : 16;
    if (iv.length !== 12 || rawKey.length !== expectedKeyLength || ciphertext.length < 17) {
      throw new Error("Invalid link data");
    }
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
    const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const decoded = JSON.parse(decoder.decode(cleartext));
    const payload = compact
      ? { v: 1, from: decoded[0], to: decoded[1], event: decoded[2] || "" }
      : decoded;
    if (
      !payload ||
      payload.v !== 1 ||
      typeof payload.from !== "string" ||
      typeof payload.to !== "string" ||
      typeof payload.event !== "string"
    ) {
      throw new Error("Invalid payload");
    }
    return payload;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("Copy failed");
    }
    showToast(successMessage);
  }

  function csvCell(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function renderLinks() {
    linkList.replaceChildren();
    for (const item of generatedLinks) {
      const row = document.createElement("div");
      row.className = "link-row";

      const name = document.createElement("span");
      name.className = "person-name";
      name.textContent = item.name;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-button";
      button.textContent = "Copy link";
      button.addEventListener("click", () => copyText(item.url, `Copied ${item.name}’s link`));

      row.append(name, button);
      linkList.append(row);
    }
  }

  function renderIntegrity(check) {
    $("#check-participants").textContent = String(check.participants);
    $("#check-recipients").textContent = String(check.uniqueRecipients);
    $("#check-self-matches").textContent = String(check.selfMatches);
    $("#check-circle").textContent = check.completeCircle ? "Yes" : "No";
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  async function generateDraw(event) {
    event.preventDefault();
    clearError();

    if (!window.crypto?.subtle) {
      showError("This browser does not support the encryption needed for private links.");
      return;
    }

    const names = parseNames(namesInput.value);
    const error = validateNames(names);
    if (error) {
      showError(error);
      namesInput.focus();
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.firstElementChild.textContent = "Creating links…";

    try {
      const circle = secureShuffle(names);
      const integrity = verifyCircle(circle);
      if (!integrity.passed) throw new Error("Draw integrity check failed");
      const eventName = eventInput.value.trim();
      const nextLinks = await Promise.all(
        circle.map(async (from, index) => {
          const to = circle[(index + 1) % circle.length];
          const url = await createPrivateLink({ v: 1, event: eventName, from, to });
          return { name: from, url };
        })
      );

      nextLinks.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      generatedLinks.splice(0, generatedLinks.length, ...nextLinks);
      renderIntegrity(integrity);
      renderLinks();
      results.hidden = false;
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error_) {
      console.error(error_);
      showError("The browser could not create the private links. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.firstElementChild.textContent = "Create private links";
    }
  }

  function updateNameCount() {
    const count = parseNames(namesInput.value).length;
    nameCount.textContent = `${count} ${count === 1 ? "person" : "people"}`;
  }

  function downloadCsv() {
    const rows = ["Participant,Private link"];
    for (const item of generatedLinks) rows.push(`${csvCell(item.name)},${csvCell(item.url)}`);
    const blob = new Blob([`\uFEFF${rows.join("\r\n")}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "secret-circle-private-links.csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  async function openParticipantView() {
    organizerView.hidden = true;
    participantView.hidden = false;
    const invalidState = $("#invalid-state");
    const sealedState = $("#sealed-state");

    try {
      revealPayload = await decryptFragment(location.hash);
      $("#participant-name").textContent = revealPayload.from;
      $("#reveal-event").textContent = revealPayload.event || "Secret Circle";
      document.title = `${revealPayload.from} · Secret Circle`;
    } catch (error) {
      console.error(error);
      sealedState.hidden = true;
      invalidState.hidden = false;
    }
  }

  function revealAssignment() {
    if (!revealPayload) return;
    $("#sealed-state").hidden = true;
    $("#assignment-name").textContent = revealPayload.to;
    $("#revealed-state").hidden = false;
  }

  namesInput.addEventListener("input", updateNameCount);
  form.addEventListener("submit", generateDraw);
  $("#reveal-button").addEventListener("click", revealAssignment);
  $("#download-links").addEventListener("click", downloadCsv);
  $("#copy-all").addEventListener("click", () => {
    const text = generatedLinks.map((item) => `${item.name}: ${item.url}`).join("\n");
    copyText(text, "Copied all private links");
  });
  $("#start-over").addEventListener("click", () => {
    generatedLinks.splice(0);
    linkList.replaceChildren();
    results.hidden = true;
    namesInput.value = "";
    eventInput.value = "";
    updateNameCount();
    window.scrollTo({ top: 0, behavior: "smooth" });
    namesInput.focus();
  });

  if (location.hash.startsWith("#sc1.") || location.hash.startsWith("#sc2.")) {
    openParticipantView();
  } else {
    updateNameCount();
  }
})();
