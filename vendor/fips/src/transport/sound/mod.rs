//! Codec-neutral complete-packet transport for the local sound bridge.
//!
//! FIPS sees only bounded opaque packets. Audio, modulation, retries and
//! browser implementation details deliberately stay outside this module.

use std::sync::{Arc, Mutex};

use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest,
    http::{header::ORIGIN, HeaderValue},
    Message,
};

use crate::config::SoundConfig;
use crate::transport::{
    ConnectionState, DiscoveredPeer, PacketTx, ReceivedPacket, Transport, TransportAddr,
    TransportError, TransportId, TransportState, TransportType,
};

const FWAV_HEADER_BYTES: usize = 32;
const FWAV_TYPE_FIPS_PACKET: u8 = 9;
const FWAV_TYPE_RESET: u8 = 8;

#[derive(Clone, Debug, Default)]
struct SoundCounters {
    tx_packets: u64,
    tx_bytes: u64,
    rx_packets: u64,
    rx_bytes: u64,
    rejected: u64,
    overflowed: u64,
    disconnects: u64,
}

struct Runtime {
    state: TransportState,
    browser_ready: bool,
    epoch: u32,
    next_sequence: u64,
    sender: Option<mpsc::Sender<Vec<u8>>>,
    last_error: Option<&'static str>,
    counters: SoundCounters,
}

impl Default for Runtime {
    fn default() -> Self {
        Self {
            state: TransportState::Configured,
            browser_ready: false,
            epoch: 1,
            next_sequence: 0,
            sender: None,
            last_error: None,
            counters: SoundCounters::default(),
        }
    }
}

/// Owned local WebSocket worker and complete-packet FIPS transport.
pub struct SoundTransport {
    transport_id: TransportId,
    name: Option<String>,
    config: SoundConfig,
    packet_tx: PacketTx,
    runtime: Arc<Mutex<Runtime>>,
    stop: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl SoundTransport {
    pub fn new(
        transport_id: TransportId,
        name: Option<String>,
        config: SoundConfig,
        packet_tx: PacketTx,
    ) -> Result<Self, TransportError> {
        config.validate().map_err(TransportError::InvalidAddress)?;
        Ok(Self {
            transport_id,
            name,
            config,
            packet_tx,
            runtime: Arc::new(Mutex::new(Runtime::default())),
            stop: None,
            worker: None,
        })
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }
    pub fn browser_ready(&self) -> bool {
        self.runtime.lock().expect("sound runtime").browser_ready
    }
    pub fn configured_peer(&self) -> TransportAddr {
        TransportAddr::from(self.config.peer_addr.clone())
    }

    /// Arms only the current bridge epoch. This is deliberately separate from
    /// the worker lifecycle: a local WebSocket being Up is not a peer claim.
    pub fn arm_browser(&self, epoch: u32) -> Result<(), TransportError> {
        let mut runtime = self.runtime.lock().expect("sound runtime");
        if runtime.state != TransportState::Up || runtime.epoch != epoch {
            runtime.counters.rejected += 1;
            runtime.last_error = Some("sound_browser_epoch_invalid");
            return Err(TransportError::SendFailed(
                "sound browser is not armed".into(),
            ));
        }
        runtime.browser_ready = true;
        Ok(())
    }

    pub async fn start_async(&mut self) -> Result<(), TransportError> {
        if !self.state().can_start() {
            return Err(TransportError::AlreadyStarted);
        }
        self.runtime.lock().expect("sound runtime").state = TransportState::Starting;
        let mut request = self
            .config
            .bridge_url
            .clone()
            .into_client_request()
            .map_err(|_| self.start_failed("sound_bridge_request_invalid"))?;
        let authority = request
            .uri()
            .authority()
            .ok_or_else(|| self.start_failed("sound_bridge_request_invalid"))?;
        let origin = HeaderValue::from_str(&format!("http://{authority}"))
            .map_err(|_| self.start_failed("sound_bridge_request_invalid"))?;
        request.headers_mut().insert(ORIGIN, origin);
        let (stream, _) = connect_async(request)
            .await
            .map_err(|_| self.start_failed("sound_bridge_connect_failed"))?;
        let (mut writer, mut reader) = stream.split();
        let (outbound_tx, mut outbound_rx) = mpsc::channel(self.config.queue_items());
        let (stop_tx, mut stop_rx) = oneshot::channel();
        let runtime = Arc::clone(&self.runtime);
        let packet_tx = self.packet_tx.clone();
        let transport_id = self.transport_id;
        let peer = self.configured_peer();
        let mtu = self.config.mtu();
        self.worker = Some(tokio::spawn(async move {
            {
                let mut current = runtime.lock().expect("sound runtime");
                current.state = TransportState::Up;
                current.sender = Some(outbound_tx);
                current.browser_ready = false;
            }
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    outbound = outbound_rx.recv() => match outbound {
                        Some(frame) => {
                            if writer.send(Message::Binary(frame.into())).await.is_err() {
                                let mut current = runtime.lock().expect("sound runtime");
                                current.counters.disconnects += 1;
                                current.last_error = Some("sound_bridge_disconnected");
                                current.browser_ready = false;
                                break;
                            }
                        }
                        None => break,
                    },
                    inbound = reader.next() => match inbound {
                        Some(Ok(Message::Binary(bytes))) => {
                            let _ = inject_inbound(&runtime, &packet_tx, transport_id, &peer, mtu, &bytes).await;
                        }
                        Some(Ok(_)) => reject(&runtime, "sound_binary_frame_required"),
                        Some(Err(_)) | None => {
                            let mut current = runtime.lock().expect("sound runtime");
                            current.counters.disconnects += 1;
                            current.last_error = Some("sound_bridge_disconnected");
                            current.browser_ready = false;
                            break;
                        }
                    },
                }
            }
            let mut current = runtime.lock().expect("sound runtime");
            current.sender = None;
            if current.state == TransportState::Up {
                current.state = TransportState::Down;
            }
        }));
        self.stop = Some(stop_tx);
        Ok(())
    }

    pub async fn stop_async(&mut self) -> Result<(), TransportError> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.await;
        }
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.sender = None;
        runtime.browser_ready = false;
        runtime.state = TransportState::Down;
        Ok(())
    }

    pub async fn send_async(
        &self,
        addr: &TransportAddr,
        data: &[u8],
    ) -> Result<usize, TransportError> {
        if addr != &self.configured_peer() {
            return Err(TransportError::InvalidAddress(
                "sound peer is not configured".into(),
            ));
        }
        if data.len() > self.config.mtu() as usize {
            return Err(TransportError::MtuExceeded {
                packet_size: data.len(),
                mtu: self.config.mtu(),
            });
        }
        let (sender, frame) = {
            let mut runtime = self.runtime.lock().expect("sound runtime");
            if runtime.state != TransportState::Up {
                return Err(TransportError::NotStarted);
            }
            if !runtime.browser_ready {
                runtime.counters.rejected += 1;
                runtime.last_error = Some("sound_browser_not_armed");
                return Err(TransportError::SendFailed(
                    "sound browser is not armed".into(),
                ));
            }
            let Some(sender) = runtime.sender.clone() else {
                runtime.counters.rejected += 1;
                runtime.last_error = Some("sound_bridge_disconnected");
                return Err(TransportError::SendFailed(
                    "sound bridge is disconnected".into(),
                ));
            };
            runtime.next_sequence = runtime.next_sequence.wrapping_add(1);
            (
                sender,
                encode_packet(runtime.epoch, runtime.next_sequence, data),
            )
        };
        sender.try_send(frame).map_err(|_| {
            let mut runtime = self.runtime.lock().expect("sound runtime");
            runtime.counters.overflowed += 1;
            runtime.last_error = Some("sound_queue_full");
            TransportError::SendFailed("sound queue is full".into())
        })?;
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.counters.tx_packets += 1;
        runtime.counters.tx_bytes += data.len() as u64;
        Ok(data.len())
    }

    pub fn transport_stats(&self) -> serde_json::Value {
        let runtime = self.runtime.lock().expect("sound runtime");
        json!({
            "browser_ready": runtime.browser_ready,
            "epoch": runtime.epoch,
            "tx_packets": runtime.counters.tx_packets,
            "tx_bytes": runtime.counters.tx_bytes,
            "rx_packets": runtime.counters.rx_packets,
            "rx_bytes": runtime.counters.rx_bytes,
            "rejected": runtime.counters.rejected,
            "overflowed": runtime.counters.overflowed,
            "disconnects": runtime.counters.disconnects,
            "last_error": runtime.last_error,
        })
    }

    fn start_failed(&self, code: &'static str) -> TransportError {
        let mut runtime = self.runtime.lock().expect("sound runtime");
        runtime.state = TransportState::Failed;
        runtime.last_error = Some(code);
        TransportError::StartFailed(code.into())
    }
}

fn reject(runtime: &Arc<Mutex<Runtime>>, code: &'static str) {
    let mut current = runtime.lock().expect("sound runtime");
    current.counters.rejected += 1;
    current.last_error = Some(code);
}

async fn inject_inbound(
    runtime: &Arc<Mutex<Runtime>>,
    packet_tx: &PacketTx,
    transport_id: TransportId,
    peer: &TransportAddr,
    mtu: u16,
    encoded: &[u8],
) -> Result<(), ()> {
    if encoded.len() < FWAV_HEADER_BYTES || &encoded[0..4] != b"FWAV" || encoded[4] != 1 {
        reject(runtime, "sound_frame_invalid");
        return Err(());
    }
    let kind = encoded[5];
    let payload_len = u32::from_le_bytes(encoded[8..12].try_into().expect("header")) as usize;
    let epoch = u32::from_le_bytes(encoded[12..16].try_into().expect("header"));
    if encoded.len() != FWAV_HEADER_BYTES + payload_len {
        reject(runtime, "sound_frame_length_invalid");
        return Err(());
    }
    if kind == FWAV_TYPE_RESET {
        let mut current = runtime.lock().expect("sound runtime");
        if payload_len != 0 || epoch <= current.epoch {
            current.counters.rejected += 1;
            current.last_error = Some("sound_reset_invalid");
            return Err(());
        }
        current.epoch = epoch;
        current.next_sequence = 0;
        current.browser_ready = false;
        current.counters = SoundCounters::default();
        current.last_error = None;
        return Ok(());
    }
    if kind != FWAV_TYPE_FIPS_PACKET || payload_len > mtu as usize {
        reject(runtime, "sound_packet_invalid");
        return Err(());
    }
    {
        let current = runtime.lock().expect("sound runtime");
        if current.state != TransportState::Up || !current.browser_ready || current.epoch != epoch {
            drop(current);
            reject(runtime, "sound_packet_not_armed");
            return Err(());
        }
    }
    let data = encoded[FWAV_HEADER_BYTES..].to_vec();
    if packet_tx
        .try_send(ReceivedPacket::new(
            transport_id,
            peer.clone(),
            data.clone(),
        ))
        .is_err()
    {
        reject(runtime, "sound_packet_channel_full");
        return Err(());
    }
    let mut current = runtime.lock().expect("sound runtime");
    current.counters.rx_packets += 1;
    current.counters.rx_bytes += data.len() as u64;
    Ok(())
}

fn encode_packet(epoch: u32, sequence: u64, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![0; FWAV_HEADER_BYTES + payload.len()];
    frame[0..4].copy_from_slice(b"FWAV");
    frame[4] = 1;
    frame[5] = FWAV_TYPE_FIPS_PACKET;
    frame[8..12].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    frame[12..16].copy_from_slice(&epoch.to_le_bytes());
    frame[16..24].copy_from_slice(&sequence.to_le_bytes());
    frame[FWAV_HEADER_BYTES..].copy_from_slice(payload);
    frame
}

impl Transport for SoundTransport {
    fn transport_id(&self) -> TransportId {
        self.transport_id
    }
    fn transport_type(&self) -> &TransportType {
        &TransportType::SOUND
    }
    fn state(&self) -> TransportState {
        self.runtime.lock().expect("sound runtime").state
    }
    fn mtu(&self) -> u16 {
        self.config.mtu()
    }
    fn start(&mut self) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use start_async for sound".into(),
        ))
    }
    fn stop(&mut self) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use stop_async for sound".into(),
        ))
    }
    fn send(&self, _addr: &TransportAddr, _data: &[u8]) -> Result<(), TransportError> {
        Err(TransportError::NotSupported(
            "use send_async for sound".into(),
        ))
    }
    fn discover(&self) -> Result<Vec<DiscoveredPeer>, TransportError> {
        Ok(Vec::new())
    }
    fn auto_connect(&self) -> bool {
        false
    }
    fn accept_connections(&self) -> bool {
        false
    }
}

impl SoundTransport {
    pub fn connection_state(&self, addr: &TransportAddr) -> ConnectionState {
        if addr == &self.configured_peer() {
            ConnectionState::None
        } else {
            ConnectionState::Failed("sound peer is not configured".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MIN_SOUND_MTU;
    use crate::transport::packet_channel;

    fn config() -> SoundConfig {
        SoundConfig {
            bridge_url: "ws://127.0.0.1:4310/bridge/fips".into(),
            peer_addr: "sound-a".into(),
            mtu: MIN_SOUND_MTU,
            queue_items: 2,
            queue_bytes: 4096,
        }
    }

    #[tokio::test]
    async fn sound_transport_fails_closed_until_current_epoch_is_armed() {
        let (tx, _rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(7), None, config(), tx).unwrap();
        assert_eq!(sound.mtu(), 1357);
        assert!(!sound.browser_ready());
        assert!(
            sound
                .send_async(&sound.configured_peer(), &[1; 1357])
                .await
                .is_err()
        );
        assert!(
            sound
                .send_async(&sound.configured_peer(), &[1; 1358])
                .await
                .is_err()
        );
        assert_eq!(sound.transport_stats()["browser_ready"], false);
    }

    #[tokio::test]
    async fn sound_injects_only_current_epoch_armed_packets_and_reset_invalidates_old_work() {
        let (tx, mut rx) = packet_channel(2);
        let sound = SoundTransport::new(TransportId::new(7), None, config(), tx).unwrap();
        {
            let mut runtime = sound.runtime.lock().unwrap();
            runtime.state = TransportState::Up;
            runtime.browser_ready = true;
        }
        let payload = vec![0x5a; 1357];
        let packet = encode_packet(1, 1, &payload);
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &packet,
        )
        .await
        .unwrap();
        assert_eq!(rx.recv().await.unwrap().data, payload);

        let mut reset = vec![0; FWAV_HEADER_BYTES];
        reset[0..4].copy_from_slice(b"FWAV");
        reset[4] = 1;
        reset[5] = FWAV_TYPE_RESET;
        reset[12..16].copy_from_slice(&2u32.to_le_bytes());
        inject_inbound(
            &sound.runtime,
            &sound.packet_tx,
            sound.transport_id,
            &sound.configured_peer(),
            sound.mtu(),
            &reset,
        )
        .await
        .unwrap();
        assert!(!sound.browser_ready());
        assert!(
            inject_inbound(
                &sound.runtime,
                &sound.packet_tx,
                sound.transport_id,
                &sound.configured_peer(),
                sound.mtu(),
                &packet
            )
            .await
            .is_err()
        );
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn sound_handle_exposes_all_connectionless_capabilities() {
        let (tx, _rx) = packet_channel(2);
        let handle = crate::transport::TransportHandle::Sound(
            SoundTransport::new(TransportId::new(8), Some("desk".into()), config(), tx).unwrap(),
        );
        let peer = TransportAddr::from("sound-a");
        assert_eq!(handle.transport_type().name, "sound");
        assert_eq!(handle.name(), Some("desk"));
        assert_eq!(handle.mtu(), 1357);
        assert_eq!(handle.link_mtu(&peer), 1357);
        assert!(handle.discover().unwrap().is_empty());
        assert!(!handle.auto_connect());
        assert!(!handle.accept_connections());
        assert!(matches!(
            handle.connection_state(&peer),
            ConnectionState::None
        ));
        assert!(matches!(
            handle.connection_state(&TransportAddr::from("sound-other")),
            ConnectionState::Failed(_)
        ));
        assert_eq!(handle.transport_stats()["browser_ready"], false);
        assert_eq!(handle.congestion().recv_drops, Some(0));
    }

    #[tokio::test]
    async fn sound_worker_round_trips_an_opaque_1357_byte_packet_over_loopback_websocket() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let expected = vec![0x3c; 1357];
        let returned = expected.clone();
        let fixture_returned = returned.clone();
        let fixture = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let (mut writer, mut reader) = socket.split();
            let outbound = reader.next().await.unwrap().unwrap().into_data();
            assert_eq!(&outbound[FWAV_HEADER_BYTES..], expected.as_slice());
            writer
                .send(Message::Binary(
                    encode_packet(1, 1, &fixture_returned).into(),
                ))
                .await
                .unwrap();
        });
        let config = SoundConfig {
            bridge_url: format!("ws://127.0.0.1:{}/bridge/fips", address.port()),
            peer_addr: "sound-a".into(),
            mtu: 1357,
            queue_items: 2,
            queue_bytes: 4096,
        };
        let (packet_tx, mut packet_rx) = packet_channel(2);
        let mut sound = SoundTransport::new(TransportId::new(9), None, config, packet_tx).unwrap();
        sound.start_async().await.unwrap();
        for _ in 0..20 {
            if sound.state() == TransportState::Up {
                break;
            }
            tokio::task::yield_now().await;
        }
        sound.arm_browser(1).unwrap();
        assert_eq!(
            sound
                .send_async(&sound.configured_peer(), &returned)
                .await
                .unwrap(),
            1357
        );
        assert_eq!(packet_rx.recv().await.unwrap().data, returned);
        fixture.await.unwrap();
        sound.stop_async().await.unwrap();
        assert_eq!(sound.state(), TransportState::Down);
    }
}
