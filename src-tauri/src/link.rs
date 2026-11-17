//! Native Ableton Link session service.
//!
//! The worker owns the Link SDK object and exchanges small commands/status snapshots
//! with Tauri. Link discovery and tempo sharing happen over the local network.

use serde::Serialize;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

const BEATS_PER_BAR: f64 = 4.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub available: bool,
    pub enabled: bool,
    pub peers: u64,
    pub bpm: f64,
    pub beat: f64,
    pub error: Option<String>,
}

impl Default for LinkStatus {
    fn default() -> Self {
        Self {
            available: true,
            enabled: false,
            peers: 0,
            bpm: 120.0,
            beat: 0.0,
            error: None,
        }
    }
}

enum Command {
    SetEnabled { enabled: bool, bpm: f64 },
    SetTempo(f64),
}

pub struct LinkManager {
    tx: mpsc::Sender<Command>,
    status: Arc<Mutex<LinkStatus>>,
}

impl LinkManager {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<Command>();
        let status = Arc::new(Mutex::new(LinkStatus::default()));
        let worker_status = Arc::clone(&status);

        thread::Builder::new()
            .name("vj-studio-ableton-link".into())
            .spawn(move || {
                let link = rusty_link::AblLink::new(120.0);
                let mut session = rusty_link::SessionState::new();

                loop {
                    match rx.recv_timeout(Duration::from_millis(40)) {
                        Ok(Command::SetEnabled { enabled, bpm }) => {
                            if enabled && !link.is_enabled() {
                                link.capture_app_session_state(&mut session);
                                session.set_tempo(safe_tempo(bpm), link.clock_micros());
                                link.commit_app_session_state(&session);
                            }
                            link.enable(enabled);
                        }
                        Ok(Command::SetTempo(bpm)) => {
                            if link.is_enabled() {
                                link.capture_app_session_state(&mut session);
                                session.set_tempo(safe_tempo(bpm), link.clock_micros());
                                link.commit_app_session_state(&session);
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }

                    link.capture_app_session_state(&mut session);
                    let snapshot = LinkStatus {
                        available: true,
                        enabled: link.is_enabled(),
                        peers: link.num_peers(),
                        bpm: session.tempo(),
                        beat: session.beat_at_time(link.clock_micros(), BEATS_PER_BAR),
                        error: None,
                    };
                    if let Ok(mut current) = worker_status.lock() {
                        *current = snapshot;
                    }
                }
            })
            .expect("Ableton-Link-Worker konnte nicht gestartet werden");

        Self { tx, status }
    }

    pub fn status(&self) -> LinkStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| LinkStatus {
                available: false,
                error: Some("Link-Status ist nicht verfügbar".into()),
                ..LinkStatus::default()
            })
    }

    pub fn set_enabled(&self, enabled: bool, bpm: f64) -> Result<(), String> {
        self.tx
            .send(Command::SetEnabled { enabled, bpm })
            .map_err(|_| "Ableton-Link-Worker ist beendet".to_string())
    }

    pub fn set_tempo(&self, bpm: f64) -> Result<(), String> {
        self.tx
            .send(Command::SetTempo(bpm))
            .map_err(|_| "Ableton-Link-Worker ist beendet".to_string())
    }
}

fn safe_tempo(bpm: f64) -> f64 {
    if bpm.is_finite() {
        bpm.clamp(20.0, 300.0)
    } else {
        120.0
    }
}

#[cfg(test)]
mod tests {
    use super::safe_tempo;

    #[test]
    fn tempo_is_clamped_to_link_limits() {
        assert_eq!(safe_tempo(10.0), 20.0);
        assert_eq!(safe_tempo(301.0), 300.0);
    }

    #[test]
    fn invalid_tempo_uses_a_safe_default() {
        assert_eq!(safe_tempo(f64::NAN), 120.0);
        assert_eq!(safe_tempo(f64::INFINITY), 120.0);
    }
}
