mod link;
mod midi;

use tauri::{Manager, State};

#[tauri::command]
fn link_status(link: State<'_, link::LinkManager>) -> link::LinkStatus {
    link.status()
}

#[tauri::command]
fn link_set_enabled(
    link: State<'_, link::LinkManager>,
    enabled: bool,
    bpm: f64,
) -> Result<(), String> {
    link.set_enabled(enabled, bpm)
}

#[tauri::command]
fn link_set_tempo(link: State<'_, link::LinkManager>, bpm: f64) -> Result<(), String> {
    link.set_tempo(bpm)
}

#[tauri::command]
fn midi_list_inputs() -> Result<Vec<midi::MidiPort>, String> {
    midi::list_inputs()
}

#[tauri::command]
fn midi_connect(
    midi: State<'_, midi::MidiService>,
    port_id: Option<String>,
) -> Result<Vec<String>, String> {
    midi.connect(port_id)
}

#[tauri::command]
fn midi_disconnect(midi: State<'_, midi::MidiService>) -> Result<(), String> {
    midi.disconnect()
}

#[tauri::command]
fn midi_status(midi: State<'_, midi::MidiService>) -> midi::MidiStatus {
    midi.status()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(link::LinkManager::new());
            app.manage(midi::MidiService::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            link_status,
            link_set_enabled,
            link_set_tempo,
            midi_list_inputs,
            midi_connect,
            midi_disconnect,
            midi_status
        ])
        .run(tauri::generate_context!())
        .expect("VJ Studio konnte nicht gestartet werden");
}
