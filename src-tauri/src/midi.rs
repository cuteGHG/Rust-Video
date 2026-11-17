//! Native MIDI input service for desktop builds.
//!
//! Each selected MIDI input is opened by a worker thread. The UI receives the same
//! note/CC bytes as the browser implementation, so its existing MIDI-learn mappings
//! and fader assignments remain in use.

use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiPort {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiStatus {
    pub connected: bool,
    pub ports: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMidiMessage {
    port_id: String,
    port_name: String,
    data: Vec<u8>,
}

enum Command {
    Connect {
        port_id: Option<String>,
        reply: mpsc::Sender<Result<Vec<String>, String>>,
    },
    Disconnect {
        reply: mpsc::Sender<()>,
    },
}

pub struct MidiService {
    tx: mpsc::Sender<Command>,
    status: Arc<Mutex<MidiStatus>>,
}

impl MidiService {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<Command>();
        let status = Arc::new(Mutex::new(MidiStatus::default()));
        let worker_status = Arc::clone(&status);

        thread::Builder::new()
            .name("vj-studio-midi".into())
            .spawn(move || {
                let mut connections: Vec<MidiInputConnection<AppHandle>> = Vec::new();

                while let Ok(command) = rx.recv() {
                    match command {
                        Command::Connect { port_id, reply } => {
                            connections.clear();
                            match open_inputs(&app, port_id.as_deref()) {
                                Ok((opened, names)) => {
                                    connections = opened;
                                    if let Ok(mut current) = worker_status.lock() {
                                        *current = MidiStatus {
                                            connected: !connections.is_empty(),
                                            ports: names.clone(),
                                            error: None,
                                        };
                                    }
                                    let _ = reply.send(Ok(names));
                                }
                                Err(error) => {
                                    if let Ok(mut current) = worker_status.lock() {
                                        *current = MidiStatus {
                                            connected: false,
                                            ports: Vec::new(),
                                            error: Some(error.clone()),
                                        };
                                    }
                                    let _ = reply.send(Err(error));
                                }
                            }
                        }
                        Command::Disconnect { reply } => {
                            connections.clear();
                            if let Ok(mut current) = worker_status.lock() {
                                *current = MidiStatus::default();
                            }
                            let _ = reply.send(());
                        }
                    }
                }
            })
            .expect("MIDI-Worker konnte nicht gestartet werden");

        Self { tx, status }
    }

    pub fn connect(&self, port_id: Option<String>) -> Result<Vec<String>, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Command::Connect {
                port_id,
                reply: reply_tx,
            })
            .map_err(|_| "MIDI-Worker ist beendet".to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "Zeitüberschreitung beim Öffnen des MIDI-Eingangs".to_string())?
    }

    pub fn disconnect(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Command::Disconnect { reply: reply_tx })
            .map_err(|_| "MIDI-Worker ist beendet".to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "MIDI-Verbindung konnte nicht geschlossen werden".to_string())
    }

    pub fn status(&self) -> MidiStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default()
    }
}

pub fn list_inputs() -> Result<Vec<MidiPort>, String> {
    let input = MidiInput::new("VJ Studio MIDI")
        .map_err(|error| format!("MIDI konnte nicht initialisiert werden: {error}"))?;
    let ports = input.ports();
    let mut result = Vec::with_capacity(ports.len());

    for port in ports {
        if let Ok(name) = input.port_name(&port) {
            result.push(MidiPort {
                id: name.clone(),
                name,
            });
        }
    }

    Ok(result)
}

fn open_inputs(
    app: &AppHandle,
    selected: Option<&str>,
) -> Result<(Vec<MidiInputConnection<AppHandle>>, Vec<String>), String> {
    let available = list_inputs()?;
    let targets: Vec<String> = match selected {
        Some(id) => available
            .iter()
            .filter(|port| port.id == id)
            .map(|port| port.id.clone())
            .collect(),
        None => available.into_iter().map(|port| port.id).collect(),
    };

    if targets.is_empty() {
        return Err(match selected {
            Some(id) => format!("MIDI-Eingang „{id}“ wurde nicht gefunden"),
            None => "Kein MIDI-Eingang verfügbar".into(),
        });
    }

    let mut connections = Vec::new();
    let mut opened_names = Vec::new();
    let mut errors = Vec::new();

    for name in targets {
        let input = match MidiInput::new("VJ Studio MIDI") {
            Ok(input) => input,
            Err(error) => {
                errors.push(format!("{name}: {error}"));
                continue;
            }
        };

        let ports = input.ports();
        let Some(port) = ports
            .iter()
            .find(|port| input.port_name(port).map(|value| value == name).unwrap_or(false))
        else {
            errors.push(format!("{name}: MIDI-Eingang ist nicht mehr verfügbar"));
            continue;
        };

        let event_app = app.clone();
        let event_id = name.clone();
        let event_name = name.clone();

        match input.connect(
            port,
            "VJ Studio MIDI input",
            move |_timestamp, message, _context| {
                let payload = NativeMidiMessage {
                    port_id: event_id.clone(),
                    port_name: event_name.clone(),
                    data: message.to_vec(),
                };
                let _ = event_app.emit("native-midi-message", payload);
            },
            (),
        ) {
            Ok(connection) => {
                connections.push(connection);
                opened_names.push(name);
            }
            Err(error) => errors.push(format!("{name}: {error}")),
        }
    }

    if connections.is_empty() {
        return Err(if errors.is_empty() {
            "Es konnte kein MIDI-Eingang geöffnet werden".into()
        } else {
            errors.join("; ")
        });
    }

    Ok((connections, opened_names))
}
