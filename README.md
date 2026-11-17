# VJ Studio Desktop

Windows-Desktop-App für den bestehenden VJ Studio Browser-Mixer.

## Architektur

- **Tauri 2 + Rust**: Desktop-Fenster, Installer, native MIDI-Eingänge und Ableton-Link-Netzwerksynchronisation.
- **Gebündelte lokale Web-Oberfläche**: Die bestehende Oberfläche und ihr Rendering bleiben für den ersten Desktop-Port erhalten. Tauri bettet den Ordner web/ in das App-Binary ein; beim Start wird keine Website aus dem Internet geladen.
- **Keine Feature-Kürzung beim ersten Port**: Clip-Grid, Ebenen, Preview/Program, Crossfader, Übergänge, Strobe, Filter, Chroma Key, Visualizer, Mikrofon/Beat-Erkennung, Kamera/Generatoren, Projektimport/-export, Szenen und MIDI-Learn werden aus dem aktuellen Web-Mixer übernommen.

Die Canvas-Medienpipeline bleibt zunächst im WebView, damit Video-/Bild-Decoding und das bestehende Verhalten erhalten bleiben. Native Rust-Komponenten ersetzen schrittweise Browser-Abhängigkeiten (zuerst MIDI und Netzwerk-Sync). Ein vollständiger nativer Rust-Renderer wäre ein separates Projekt und darf erst die Web-Pipeline ersetzen, wenn Funktionsparität nachgewiesen ist.

## Netzwerk: Ableton Link

Der Schalter **ABLETON LINK verbinden** aktiviert die native Ableton-Link-Sitzung über das lokale Netzwerk. Link findet kompatible Geräte automatisch; es ist keine Server-Adresse einzugeben. Angezeigt werden Verbindungsstatus, Peer-Anzahl und BPM. Ein lokaler TAP-Tempo-/Beat-Wert kann an die Link-Sitzung gesendet werden.

Link verwendet UDP-Netzwerkverkehr und muss in der Windows-Firewall für private Netzwerke zugelassen sein. Geräte müssen sich in einem Netzwerk befinden, in dem Multicast/Link-Verkehr nicht blockiert wird.

## MIDI

Die Desktop-App verwendet unter Windows midir statt der browserabhängigen Web-MIDI-API. Sie kann alle MIDI-Eingänge gleichzeitig öffnen oder einen Eingang auswählen. Die bestehenden Note-/CC-Aktionen und vier MIDI-Fader werden durch die Website-Logik verarbeitet.

## Windows-Build

Voraussetzungen zum lokalen Entwickeln:
- Rust stable (MSVC toolchain)
- Microsoft C++ Build Tools („Desktop development with C++“)
- CMake (für Ableton Link)
- WebView2 Runtime

Dann im Repository-Root:

    cargo install tauri-cli --version "^2.0.0" --locked
    cargo tauri dev
    cargo tauri build --bundles nsis

Der Build erzeugt einen Windows-Installer unter:

    src-tauri/target/release/bundle/nsis/

Der NSIS-Installer ist eine Setup-EXE. Das Anwendungsfenster und alle Web-Dateien werden im Build gebündelt. Der Installer nutzt den WebView2-Evergreen-Bootstrapper, falls WebView2 auf dem Zielsystem fehlt; beim ersten Installieren ist dafür Internetzugang nötig.

## Automatischer Build

GitHub Actions baut den NSIS-Installer auf windows-latest und veröffentlicht ihn als Workflow-Artefakt. Der Build läuft bei Pull Requests, Pushes auf main und manuell über Actions.

## Geprüfte und noch nicht geprüfte Bereiche

- Native Ableton Link und MIDI sind in Rust implementiert.
- Die bestehende Frontend-Feature-Fläche wird unverändert übernommen, mit Desktop-Bridge für Link und native MIDI.
- Ein erfolgreicher Windows-Build, WebView2-Kamera-/Mikrofonberechtigungen, externe Output-Fenster und die Funktion mit konkreter MIDI-/Link-Hardware müssen auf einem Windows-Rechner durch CI bzw. einen Gerätetest bestätigt werden. Vorher wird keine vollständige Hardware-Kompatibilität behauptet.
