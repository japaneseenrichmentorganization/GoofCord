// prevencordmarker

// src/windows/main/renderer/preVencord/patchManager.ts
var IDENTIFIER_PATTERN = "(?:[A-Za-z_$][\\w$]*)";
var PATCHES = "__GOOFCORD_PATCHES__";
var GLOBALS = "GoofCordPatchGlobals";
var GLOBAL_REF = `window.${GLOBALS}`;
window[PATCHES] = window[PATCHES] || [];
window[GLOBALS] = window[GLOBALS] || {};
var definePatch = (config) => config;
function loadPatches(definitions) {
  for (const def of definitions) {
    const { patches, condition, ...helpers } = def;
    if (condition && !condition())
      continue;
    Object.assign(window[GLOBALS], helpers);
    const readyPatches = patches.map(processPatch);
    window[PATCHES].push(...readyPatches);
  }
}
function processPatch(patch) {
  const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];
  return {
    ...patch,
    plugin: "GoofCord",
    find: expandRegex(patch.find),
    replacement: replacements.map((rep) => ({
      match: expandRegex(rep.match),
      replace: linkHelpers(rep.replace.toString())
    }))
  };
}
function expandRegex(input) {
  if (input instanceof RegExp) {
    const source = input.source.replaceAll("\\i", IDENTIFIER_PATTERN);
    return new RegExp(source, input.flags);
  }
  return input.replaceAll("\\i", IDENTIFIER_PATTERN);
}
function linkHelpers(input) {
  return input.replaceAll("$self", GLOBAL_REF);
}

// src/windows/main/renderer/preVencord/patches/devtoolsFix.ts
var devtoolsFix_default = definePatch({
  patches: [
    {
      find: '"mod+alt+i"',
      replacement: {
        match: /"discord\.com"===location\.host/,
        replace: "false"
      }
    },
    {
      find: "setDevtoolsCallbacks",
      replacement: {
        match: /if\(null!=\i&&"0.0.0"===\i\.app\.getVersion\(\)\)/,
        replace: "if(true)"
      }
    }
  ]
});

// src/windows/main/renderer/preVencord/patches/invidiousEmbeds.ts
var invidiousEmbeds_default = definePatch({
  patches: [
    {
      find: 'analyticsSource:"EmbedVideo"',
      replacement: {
        match: /(:[^,]+,src:[^\.]+.url)/,
        replace: "$1?.replace('https://www.youtube.com/embed/', (window.invidiousInstance ?? 'https://www.youtube.com')+'/embed/')+'?autoplay=1&player_style=youtube&local=true'"
      }
    }
  ]
});

// src/windows/main/renderer/preVencord/patches/keybinds.ts
var keybinds_default = definePatch({
  patches: [
    {
      find: "keybindActionTypes",
      replacement: [
        { match: /\i\.isPlatformEmbedded/g, replace: "true" },
        { match: /\(0,\i\.isDesktop\)\(\)/g, replace: "true" }
      ]
    }
  ]
});

// src/windows/main/renderer/preVencord/patches/screenshare.ts
var screenshare_default = definePatch({
  patches: [
    {
      find: "this.getDefaultGoliveQuality()",
      replacement: {
        match: /this\.getDefaultGoliveQuality\(\)/,
        replace: "$self.patchStreamQuality($&)"
      }
    },
    {
      find: "canUseCustomStickersEverywhere:",
      replacement: {
        match: /(?<=canStreamQuality:function\(\i,\i\)\{)/,
        replace: "return true;"
      }
    }
  ],
  patchStreamQuality(opts) {
    const screenshareQuality = window.screenshareSettings;
    if (!screenshareQuality)
      return opts;
    const framerate = Number(screenshareQuality.framerate);
    const height = Number(screenshareQuality.resolution);
    const width = Math.round(height * (screen.width / screen.height));
    Object.assign(opts, {
      bitrateMin: 500000,
      bitrateMax: 8000000,
      bitrateTarget: 600000
    });
    const videoParams = {
      framerate,
      width,
      height,
      pixelCount: height * width
    };
    if (opts?.encode)
      Object.assign(opts.encode, videoParams);
    Object.assign(opts.capture, videoParams);
    return opts;
  }
});

// src/windows/main/renderer/preVencord/patches/titlebar.ts
var titlebar_default = definePatch({
  condition: () => window.goofcord.getConfig("customTitlebar"),
  patches: [
    {
      find: '"refresh-title-bar-small"',
      replacement: [
        { match: /\i===\i\.PlatformTypes\.WINDOWS/g, replace: "true" },
        { match: /\i===\i\.PlatformTypes\.WEB/g, replace: "false" }
      ]
    },
    {
      find: ",setSystemTrayApplications",
      replacement: [
        {
          match: /\i\.window\.(close|minimize|maximize)/g,
          replace: "goofcord.window.$1"
        }
      ]
    }
  ]
});

// glob-plugin:eyJjb21tYW5kIjoiaW1wb3J0IiwiZ2xvYlBhdHRlcm4iOiIuL3BhdGNoZXMvKiovKi50cyIsImltcG9ydGVyIjoiL2hvbWUvYmx1YnNreWUvR29vZkNvcmQvc3JjL3dpbmRvd3MvbWFpbi9yZW5kZXJlci9wcmVWZW5jb3JkL3ByZVZlbmNvcmQudHMifQ
var eyJjb21tYW5kIjoiaW1wb3J0IiwiZ2xvYlBhdHRlcm4iOiIuL3BhdGNoZXMvKiovKi50cyIsImltcG9ydGVyIjoiL2hvbWUvYmx1YnNreWUvR29vZkNvcmQvc3JjL3dpbmRvd3MvbWFpbi9yZW5kZXJlci9wcmVWZW5jb3JkL3ByZVZlbmNvcmQudHMifQ_default = {
  "devtoolsFix.ts": devtoolsFix_default,
  "invidiousEmbeds.ts": invidiousEmbeds_default,
  "keybinds.ts": keybinds_default,
  "screenshare.ts": screenshare_default,
  "titlebar.ts": titlebar_default
};

// src/windows/main/renderer/preVencord/audioBandpass.ts
var audioCtx = null;
var activeChains = new Set;
var remoteCache = new WeakMap;
function isEnabled() {
  return window.goofcord.getConfig("audioBandpass");
}
function getCutoffs() {
  const low = Number.parseFloat(window.goofcord.getConfig("bandpassLowHz"));
  const high = Number.parseFloat(window.goofcord.getConfig("bandpassHighHz"));
  return [Number.isFinite(low) && low > 0 ? low : 80, Number.isFinite(high) && high > 0 ? high : 15000];
}
function getContext() {
  if (!audioCtx)
    audioCtx = new AudioContext;
  if (audioCtx.state === "suspended")
    audioCtx.resume();
  return audioCtx;
}
function createChain(stream) {
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
  const chain = { highpass, lowpass };
  activeChains.add(chain);
  const output = destination.stream;
  for (const track of stream.getVideoTracks())
    output.addTrack(track);
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
function filterMicStream(stream) {
  const { output } = createChain(stream);
  const originalTrack = stream.getAudioTracks()[0];
  const filteredTrack = output.getAudioTracks()[0];
  if (originalTrack && filteredTrack) {
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
function filterRemoteStream(stream) {
  const cached = remoteCache.get(stream);
  if (cached)
    return cached;
  const { output } = createChain(stream);
  const primer = new Audio;
  primer.muted = true;
  originalSrcObjectSetter.call(primer, stream);
  output.__goofcordPrimer = primer;
  remoteCache.set(stream, output);
  return output;
}
var srcObjectDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
var originalSrcObjectSetter = srcObjectDescriptor?.set;
function patchSrcObject() {
  if (!srcObjectDescriptor?.set || !srcObjectDescriptor.get)
    return;
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    enumerable: srcObjectDescriptor.enumerable,
    get: srcObjectDescriptor.get,
    set(value) {
      if (value instanceof MediaStream && value.getAudioTracks().length > 0 && isEnabled()) {
        try {
          originalSrcObjectSetter.call(this, filterRemoteStream(value));
          return;
        } catch (err) {
          console.error("[Audio Bandpass] Failed to filter incoming stream:", err);
        }
      }
      originalSrcObjectSetter.call(this, value);
    }
  });
}
function patchGetUserMedia() {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await originalGetUserMedia(constraints);
    if (!constraints?.audio || !isEnabled())
      return stream;
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
    highpass.frequency.value = enabled ? low : 0;
    lowpass.frequency.value = enabled ? high : ctx ? ctx.sampleRate / 2 : 24000;
  }
}
function startAudioBandpass() {
  patchGetUserMedia();
  patchSrcObject();
  window.goofcord.onFiltersConfigChanged(updateActiveChains);
}

// src/windows/main/renderer/preVencord/domOptimizer.ts
function startDomOptimizer() {
  if (!window.goofcord.getConfig("domOptimizer"))
    return;
  function optimize(orig) {
    const delayedClasses = ["activity", "gif", "avatar", "imagePlaceholder", "hoverBar"];
    return function(...args) {
      const element = args[0];
      if (typeof element?.className === "string") {
        if (delayedClasses.some((partial) => element.className.includes(partial))) {
          setTimeout(() => orig.apply(this, args), 100 - Math.random() * 50);
          return;
        }
      }
      return orig.apply(this, args);
    };
  }
  Element.prototype.removeChild = optimize(Element.prototype.removeChild);
}

// src/windows/main/renderer/preVencord/notificationFix.ts
function fixNotifications() {
  const originalSetter = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")?.set;
  Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
      originalSetter?.call(this, (...args) => {
        onClick.apply(this, args);
        window.goofcord.window.show();
      });
    },
    configurable: true
  });
}

// src/windows/main/renderer/preVencord/preVencord.ts
if (window.goofcord.isVencordPresent()) {
  const patches = Object.values(eyJjb21tYW5kIjoiaW1wb3J0IiwiZ2xvYlBhdHRlcm4iOiIuL3BhdGNoZXMvKiovKi50cyIsImltcG9ydGVyIjoiL2hvbWUvYmx1YnNreWUvR29vZkNvcmQvc3JjL3dpbmRvd3MvbWFpbi9yZW5kZXJlci9wcmVWZW5jb3JkL3ByZVZlbmNvcmQudHMifQ_default);
  loadPatches(patches);
}
fixNotifications();
startDomOptimizer();
startAudioBandpass();
