(() => {
  "use strict";

  const api = window.__TAURI__;
  const invoke = api?.core?.invoke;
  const listen = api?.event?.listen;
  const isDesktop = typeof invoke === "function";
  const byId = (id) => document.getElementById(id);

  if (!isDesktop) {
    const linkButton = byId("linkToggle");
    if (linkButton) linkButton.disabled = true;
    const linkStatus = byId("linkStatus");
    if (linkStatus) linkStatus.textContent = "LINK NUR IN DER DESKTOP-APP";
    return;
  }

  let midiConnected = false;
  let linkEnabled = false;
  let lastTempoSent = 0;
  let lastLinkTempo = 0;

  function setMidiUi(connected, message) {
    midiConnected = connected;
    const midiButton = byId("midiToggle");
    const settingsButton = byId("midiConnectSettings");
    const midiStatus = byId("midiStatus");
    const info = byId("midiSettingsStatus");
    if (midiButton) midiButton.textContent = connected ? "MIDI trennen" : "MIDI verbinden";
    if (settingsButton) settingsButton.textContent = connected ? "MIDI trennen" : "MIDI verbinden";
    if (midiStatus) midiStatus.textContent = connected ? "MIDI READY" : "MIDI OFF";
    if (info && message) info.textContent = message;
  }

  async function refreshNativeMidiInputs() {
    const select = byId("midiInputSelect");
    if (!select) return;
    const selected = select.value;
    try {
      const ports = await invoke("midi_list_inputs");
      select.replaceChildren(new Option("Alle Eingänge", ""));
      for (const port of ports) select.add(new Option(port.name, port.id));
      if ([...select.options].some((option) => option.value === selected)) {
        select.value = selected;
      }
      const info = byId("midiSettingsStatus");
      if (info && !midiConnected) {
        info.textContent = ports.length
          ? "Native MIDI-Eingänge gefunden: " + ports.length
          : "Keine MIDI-Eingänge gefunden. Controller anschließen und aktualisieren.";
      }
    } catch (error) {
      const info = byId("midiSettingsStatus");
      if (info) info.textContent = "MIDI-Geräte konnten nicht gelesen werden: " + error;
    }
  }

  async function toggleNativeMidi() {
    try {
      if (midiConnected) {
        await invoke("midi_disconnect");
        setMidiUi(false, "MIDI-Verbindung getrennt.");
        return;
      }
      await refreshNativeMidiInputs();
      const selected = byId("midiInputSelect")?.value || null;
      const opened = await invoke("midi_connect", { portId: selected });
      setMidiUi(true, "MIDI verbunden: " + opened.join(", "));
    } catch (error) {
      setMidiUi(false, "MIDI-Verbindung fehlgeschlagen: " + error);
      const status = byId("midiStatus");
      if (status) status.textContent = "MIDI ERROR";
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#midiToggle, #midiConnectSettings");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void toggleNativeMidi();
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("#openSettings")) return;
    window.setTimeout(() => void refreshNativeMidiInputs(), 0);
  }, true);

  if (typeof listen === "function") {
    listen("native-midi-message", (event) => {
      const payload = event.payload || {};
      if (typeof window.midiMessage === "function") {
        window.midiMessage({
          data: payload.data || [],
          currentTarget: {
            id: payload.portId || payload.portName || "native-midi",
            name: payload.portName || "MIDI"
          }
        });
      }
    }).catch((error) => {
      const info = byId("midiSettingsStatus");
      if (info) info.textContent = "MIDI-Ereignisse konnten nicht registriert werden: " + error;
    });
  }

  function setLinkUi(status) {
    linkEnabled = !!status.enabled;
    const button = byId("linkToggle");
    const label = byId("linkStatus");
    if (button) {
      button.textContent = linkEnabled ? "ABLETON LINK trennen" : "ABLETON LINK verbinden";
      button.classList.toggle("active", linkEnabled);
    }
    if (label) {
      label.textContent = linkEnabled
        ? "LINK LIVE · " + status.peers + " PEER(S) · " + Number(status.bpm).toFixed(1) + " BPM"
        : "LINK OFF · NETZWERK";
      label.title = status.error || "Ableton Link entdeckt andere Geräte im lokalen Netzwerk automatisch.";
    }
  }

  async function pollLink() {
    try {
      const status = await invoke("link_status");
      setLinkUi(status);
      if (status.enabled && Number(status.bpm) > 0) {
        const period = 60000 / Number(status.bpm);
        const fraction = ((Number(status.beat) % 1) + 1) % 1;
        const now = performance.now();
        state.beatBpm = Number(status.bpm);
        state.beatPeriod = period;
        state.beatConfidence = 1;
        state.lastBeatAt = now - fraction * period;
        state.nextBeatAt = now + (1 - fraction) * period;
        lastLinkTempo = Number(status.bpm);
        const candidate = state.micEnabled
          ? Number(state.beatBpm)
          : Number(browserEngine?.manualBpm || 0);
        if (candidate > 0 && Math.abs(candidate - lastLinkTempo) > 1.0 && Date.now() - lastTempoSent > 1200) {
          lastTempoSent = Date.now();
          await invoke("link_set_tempo", { bpm: candidate });
        }
      }
    } catch (error) {
      const label = byId("linkStatus");
      if (label) label.textContent = "LINK FEHLER · " + error;
    }
  }

  byId("linkToggle")?.addEventListener("click", async () => {
    const button = byId("linkToggle");
    if (button) button.disabled = true;
    try {
      const bpm = Number(state.beatBpm || browserEngine?.manualBpm || 120);
      await invoke("link_set_enabled", { enabled: !linkEnabled, bpm });
      await pollLink();
    } catch (error) {
      const label = byId("linkStatus");
      if (label) label.textContent = "LINK VERBINDUNG FEHLGESCHLAGEN · " + error;
    } finally {
      if (button) button.disabled = false;
    }
  });

  void refreshNativeMidiInputs();
  void pollLink();
  window.setInterval(pollLink, 250);
})();
