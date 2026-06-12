// Bandpass filter (default 80 Hz - 15 kHz) for voice audio.
// Microphone: getUserMedia streams are routed through highpass + lowpass biquads.
// Headset: incoming WebRTC voice is intercepted via the HTMLMediaElement.srcObject setter.
// Cutoff changes apply live to active streams; toggling the filter on/off
// only affects streams created afterwards (i.e. the next voice connection).

interface FilterChain {
	highpass: BiquadFilterNode;
	lowpass: BiquadFilterNode;
}

let audioCtx: AudioContext | null = null;
const activeChains = new Set<FilterChain>();
// Remote streams can be assigned to multiple elements; reuse the filtered version
const remoteCache = new WeakMap<MediaStream, MediaStream>();

function isEnabled(): boolean {
	return window.goofcord.getConfig("audioBandpass");
}

function getCutoffs(): [number, number] {
	const low = Number.parseFloat(window.goofcord.getConfig("bandpassLowHz"));
	const high = Number.parseFloat(window.goofcord.getConfig("bandpassHighHz"));
	return [Number.isFinite(low) && low > 0 ? low : 80, Number.isFinite(high) && high > 0 ? high : 15000];
}

function getContext(): AudioContext {
	if (!audioCtx) audioCtx = new AudioContext();
	if (audioCtx.state === "suspended") void audioCtx.resume();
	return audioCtx;
}

function createChain(stream: MediaStream): { output: MediaStream; chain: FilterChain } {
	const ctx = getContext();
	const [low, high] = getCutoffs();

	const source = ctx.createMediaStreamSource(stream);
	const highpass = ctx.createBiquadFilter();
	highpass.type = "highpass";
	highpass.frequency.value = low;
	const lowpass = ctx.createBiquadFilter();
	lowpass.type = "lowpass";
	lowpass.frequency.value = high;
	const destination = ctx.createMediaStreamDestination();

	source.connect(highpass);
	highpass.connect(lowpass);
	lowpass.connect(destination);

	const chain: FilterChain = { highpass, lowpass };
	activeChains.add(chain);

	const output = destination.stream;
	for (const track of stream.getVideoTracks()) output.addTrack(track);

	// Stop tracking once the source audio is gone
	for (const track of stream.getAudioTracks()) {
		track.addEventListener("ended", () => {
			if (stream.getAudioTracks().every((t) => t.readyState === "ended")) {
				source.disconnect();
				activeChains.delete(chain);
			}
		});
	}

	return { output, chain };
}

function filterMicStream(stream: MediaStream): MediaStream {
	const { output } = createChain(stream);

	const originalTrack = stream.getAudioTracks()[0];
	const filteredTrack = output.getAudioTracks()[0];
	if (originalTrack && filteredTrack) {
		// Discord only knows about the filtered track; forward lifecycle and
		// constraint operations to the real capture track so the mic actually
		// turns off and voice settings keep working.
		const origStop = filteredTrack.stop.bind(filteredTrack);
		filteredTrack.stop = () => {
			origStop();
			originalTrack.stop();
		};
		filteredTrack.applyConstraints = (constraints) => originalTrack.applyConstraints(constraints);
		filteredTrack.getSettings = () => originalTrack.getSettings();
		filteredTrack.getCapabilities = () => originalTrack.getCapabilities();
	}

	return output;
}

function filterRemoteStream(stream: MediaStream): MediaStream {
	const cached = remoteCache.get(stream);
	if (cached) return cached;

	const { output } = createChain(stream);

	// Chromium quirk: remote WebRTC streams produce no data in the Web Audio
	// graph unless they are also attached to a media element.
	const primer = new Audio();
	primer.muted = true;
	originalSrcObjectSetter.call(primer, stream);
	(output as any).__goofcordPrimer = primer; // keep the primer alive as long as the stream

	remoteCache.set(stream, output);
	return output;
}

const srcObjectDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
const originalSrcObjectSetter = srcObjectDescriptor?.set as (this: HTMLMediaElement, value: MediaProvider | null) => void;

function patchSrcObject() {
	if (!srcObjectDescriptor?.set || !srcObjectDescriptor.get) return;

	Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
		configurable: true,
		enumerable: srcObjectDescriptor.enumerable,
		get: srcObjectDescriptor.get,
		set(this: HTMLMediaElement, value: MediaProvider | null) {
			if (value instanceof MediaStream && value.getAudioTracks().length > 0 && isEnabled()) {
				try {
					originalSrcObjectSetter.call(this, filterRemoteStream(value));
					return;
				} catch (err) {
					console.error("[Audio Bandpass] Failed to filter incoming stream:", err);
				}
			}
			originalSrcObjectSetter.call(this, value);
		},
	});
}

function patchGetUserMedia() {
	const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

	navigator.mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
		const stream = await originalGetUserMedia(constraints);
		if (!constraints?.audio || !isEnabled()) return stream;

		try {
			return filterMicStream(stream);
		} catch (err) {
			console.error("[Audio Bandpass] Failed to filter microphone stream:", err);
			return stream;
		}
	};
}

function updateActiveChains() {
	const [low, high] = getCutoffs();
	const enabled = isEnabled();
	const ctx = audioCtx;

	for (const { highpass, lowpass } of activeChains) {
		// When disabled mid-stream, open the band up as a passthrough
		highpass.frequency.value = enabled ? low : 0;
		lowpass.frequency.value = enabled ? high : ctx ? ctx.sampleRate / 2 : 24000;
	}
}

export function startAudioBandpass() {
	patchGetUserMedia();
	patchSrcObject();
	window.goofcord.onFiltersConfigChanged(updateActiveChains);
}
