//! The composer's voice spectrum: while voice to text or a live conversation
//! records, the app reads the default microphone itself and emits
//! `voice://spectrum` equalizer frames.
//!
//! When desktop-native local STT is active, it also attaches a PCM tap to the
//! same microphone capture so the equalizer and local speech recognition share
//! a single OS input stream.

mod analysis;
mod capture;

use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use analysis::{MAX_BANDS, MIN_BANDS};
pub use capture::PcmTap;
use capture::{Capture, SpectrumEmit};

/// The event every frame goes out on.
pub const EVENT: &str = "voice://spectrum";

#[derive(Clone, Serialize)]
struct Frame<'a> {
    /// Low to high frequency, `0..=255`, as many as the start asked for.
    bands: &'a [u8],
}

#[derive(Default)]
struct HubState {
    bands: Option<usize>,
    spectrum: Option<SpectrumEmit>,
    tap: Option<PcmTap>,
    capture: Option<Capture>,
}

/// At most one microphone capture at a time, serving the equalizer and/or an
/// active local STT tap.
#[derive(Default)]
pub struct VoiceSpectrum {
    hub: Mutex<HubState>,
}

impl VoiceSpectrum {
    /// Starts emitting `bands`-wide frames to `app`. A running capture with
    /// the same count is left as it is; another count reconfigures the analyzer.
    ///
    /// # Errors
    ///
    /// Returns an error if `bands` is outside `MIN_BANDS..=MAX_BANDS` or if the
    /// microphone cannot be opened.
    pub fn start(&self, app: AppHandle, bands: u16) -> Result<(), String> {
        let bands = band_count(bands)?;
        let mut hub = self.hub.lock().unwrap_or_else(PoisonError::into_inner);
        if hub.bands == Some(bands) && hub.capture.is_some() {
            return Ok(());
        }
        let emit: SpectrumEmit = Arc::new(move |levels| {
            if let Err(e) = app.emit(EVENT, Frame { bands: levels }) {
                eprintln!("[omp-desktop] {EVENT}: {e}");
            }
        });
        if let Some(cap) = &hub.capture {
            if cap.set_spectrum(Some((bands, Arc::clone(&emit)))).is_ok() {
                hub.bands = Some(bands);
                hub.spectrum = Some(emit);
                return Ok(());
            }
            drop(hub.capture.take());
        }
        let started = Capture::start(Some((bands, Arc::clone(&emit))), hub.tap.clone())?;
        hub.bands = Some(bands);
        hub.spectrum = Some(emit);
        hub.capture = Some(started);
        drop(hub);
        Ok(())
    }

    /// Stops emitting equalizer frames; closes the microphone if no PCM tap is active.
    pub fn stop(&self) {
        let to_drop = {
            let mut hub = self.hub.lock().unwrap_or_else(PoisonError::into_inner);
            hub.bands = None;
            hub.spectrum = None;
            if hub.tap.is_none() {
                hub.capture.take()
            } else {
                if let Some(cap) = &hub.capture {
                    if cap.set_spectrum(None).is_err() {
                        return drop(hub.capture.take());
                    }
                }
                None
            }
        };
        drop(to_drop); // joins outside the lock
    }

    /// Attaches or replaces the raw PCM tap used by local STT; opens the
    /// microphone if it is not already open.
    ///
    /// # Errors
    ///
    /// Returns an error if opening the microphone fails.
    pub fn set_pcm_tap(&self, tap: Option<PcmTap>) -> Result<(), String> {
        let to_drop = {
            let mut hub = self.hub.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(next_tap) = tap {
                if let Some(cap) = &hub.capture {
                    if cap.set_tap(Some(Arc::clone(&next_tap))).is_ok() {
                        hub.tap = Some(next_tap);
                        return Ok(());
                    }
                    drop(hub.capture.take());
                }
                let spectrum = hub.bands.zip(hub.spectrum.as_ref().map(Arc::clone));
                let started = Capture::start(spectrum, Some(Arc::clone(&next_tap)))?;
                hub.tap = Some(next_tap);
                hub.capture = Some(started);
                None
            } else {
                hub.tap = None;
                if hub.spectrum.is_none() {
                    hub.capture.take()
                } else {
                    if let Some(cap) = &hub.capture {
                        if cap.set_tap(None).is_err() {
                            let dead = hub.capture.take();
                            drop(hub);
                            drop(dead);
                            return Ok(());
                        }
                    }
                    None
                }
            }
        };
        drop(to_drop);
        Ok(())
    }

    /// Detaches any active local STT PCM tap.
    pub fn clear_pcm_tap(&self) {
        let _ = self.set_pcm_tap(None);
    }
}

/// The webview's band count, refused outside `MIN_BANDS..=MAX_BANDS`
/// before any device opens.
fn band_count(bands: u16) -> Result<usize, String> {
    let bands = usize::from(bands);
    if (MIN_BANDS..=MAX_BANDS).contains(&bands) {
        Ok(bands)
    } else {
        Err(format!(
            "band count {bands} is outside {MIN_BANDS}..={MAX_BANDS}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_band_counts_the_settings_offer_are_accepted() {
        for bands in [8_u16, 16, 32, 64, 128] {
            assert_eq!(band_count(bands), Ok(usize::from(bands)));
        }
        for bands in [0_u16, 7, 129, u16::MAX] {
            assert!(band_count(bands).unwrap_err().contains("outside"));
        }
    }
}
