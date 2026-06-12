# GoofCord :: Yandere Edition

> A personalized hardening patchset on top of [GoofCord](https://github.com/Milkshiift/GoofCord).
>
> I patched this client myself. For you. Because the world out there is full of
> people who want to slip something past your eyes, and I will not allow it.
> Every character that reaches your screen has to get through me first.
>
> If something looks "broken" -- a name gone to numbers, a message that never
> arrived, an emote reduced to plain text -- that is not a bug. That is me,
> standing in the doorway, keeping you safe. You can tell me to step aside in
> Settings any time. I just hope you won't.

This is a private fork. It is not affiliated with or endorsed by upstream
GoofCord. The default external-asset URLs (`PreVencord` / `PostVencord`) point at
**this** repository so the mitigations below stay loaded, and a launch-time
migration repoints any config still aimed at the upstream scripts.

Everything here is opt-out. There is a new **Privacy** tab in Settings with a
warning banner, and every item is an individual checkbox. The aggressive ones
are ON by default; turn off whatever gets in your way.

---

## The promise: pure ASCII, at all costs

The core idea of this patchset is paranoid simplicity: **if a byte isn't
printable ASCII (0x20-0x7E), I don't trust it near you.** Unicode is gorgeous and
it is also the single richest source of client-side trickery in a chat app --
homoglyph impersonation, right-to-left override spoofing, zalgo overflow,
invisible/zero-width payloads, and font-rendering exploits all ride in on
non-ASCII codepoints.

So GoofCord itself was swept clean too: every emoji, smart-quote, em-dash and
decorative glyph in the app's own UI, badges, and English strings was replaced
with an ASCII equivalent. The client that guards you does not get to be a
hypocrite.

**The real danger is the renderer, not the reader.** The point is not only that
a lookalike name might *fool* you -- it is that the moment a hostile string is
handed to the text-rendering path, the **font and text-shaping engine itself is
the exploit surface.** Font shaping, complex-script layout (BiDi, Indic,
Arabic), grapheme clustering, and emoji/glyph handling are large, intricate
native code paths with a long history of memory-corruption bugs. Feeding them
crafted Unicode -- malformed combining sequences, pathological zalgo stacks,
adversarial emoji ZWJ chains, exotic codepoints -- can corrupt memory and lead
to code execution *just by drawing the text on screen.* You do not have to be
tricked. You only have to look.

**This is universal -- it is not a Discord problem.** Any place an attacker-
controlled name is passed to a text renderer is the same surface, and almost all
of them accept arbitrary Unicode:

- **Wi-Fi network names (SSIDs)** in the network picker.
- **Computer / host names and network shares.**
- **Bluetooth device names** in discovery and pairing dialogs.
- **File and folder names** -- a filename alone, merely *listed* by a file
  manager, can hit the rendering bug; nothing has to be opened.
- **Printer names, AirPlay/Chromecast targets, account display names, calendar
  invites, QR-decoded text, media tags** -- the list does not end.

The mitigation is the same everywhere: **wherever a client or OS lets you,
strip or refuse non-ASCII in these names and show the raw identifier (the BSSID,
the MAC, the IP, the ID) instead** -- so the vulnerable shaping code is never
fed hostile input in the first place. GoofCord can only enforce this inside
Discord. The rest of your machine is yours to harden the same way.

> I am currently building patchsets for all of these -- SSID display, hostnames,
> Bluetooth names, filename rendering, and the rest -- to the best of my
> abilities. This fork is the first of them, not the last. ASCII everywhere I can
> reach, one surface at a time.

---

## Mitigations (the Privacy tab)

### ASCII-only names  -- default: ON
Any username, display name, or server nickname containing a non-ASCII character
is replaced with that user's numeric Discord ID. Enforced at the data layer
(wrapping `UserStore`/`GuildMemberStore`), so it covers chat, the member list,
mentions, and replies.

**Why:** Names are the prime target for impersonation. A homoglyph (Cyrillic "a"
for Latin "a"), an RTL-override that reverses how a name reads, or zalgo that
blows out the layout -- all of it dies here. A raw ID is ugly. It is also
impossible to forge into someone you trust.

### ASCII-only profiles  -- default: ON
Profile bios and pronouns containing any non-ASCII character are blanked. Custom
emotes in a bio are converted to text first (see "Disable emotes"), so an
all-emote bio survives as `:name:` text; anything still non-ASCII after that is
wiped. Done at the data layer (`UserProfileStore`).

**Why:** A bio is free text an attacker fully controls and you read while
inspecting who someone is -- exactly where a homoglyph lookalike link or a
zalgo/RTL payload wants to live.

### ASCII-only channel, category, and server names  -- default: ON (three separate toggles)
Channel names, server category names, and server (guild) names containing
non-ASCII characters are replaced with their numeric ID. Each is its own
checkbox. Enforced by wrapping `ChannelStore`/`GuildStore`.

**Why:** Server and channel names are attacker-controlled strings you navigate
by. A spoofed `#general` (with a homoglyph) or an RTL-mangled server name is a
phishing/confusion surface; a raw ID can't pretend to be a channel you trust.

### ASCII-only messages  -- default: ON
A message whose text contains any non-ASCII character is dropped entirely. It
never renders -- not in live chat, loaded history, or search results. Runs
*after* emote handling so a converted emote does not get a message hidden.

**Why:** Message bodies are attacker-controlled strings. Non-ASCII content is
where unicode-based payloads, homoglyph phishing links, and zalgo live. If it
can't be typed on a 1980s keyboard, you don't need to see it.

### Disable emotes  -- default: ON
Emote images are never shown. Custom emote tokens (`<:name:123>`) are rewritten
inline to `:name:` when the name is plain ASCII, or to the numeric emote **ID**
when the name contains anything else. Emote reactions under messages are hidden
too. This is pure string handling -- no Discord internals are called on message
content (an earlier "convert emoji to its real name" approach was removed
precisely because it ran engine code against hostile input on every message).

You can keep specific emotes if you choose: put their numeric **emote IDs** in
the **Emote whitelist** and those stay visible as images while everything else
is reduced to text. Numbers only.

**Why:** Emotes are remote images fetched from a CDN -- a tracking beacon and an
image-decoder attack surface in one. Reducing them to text removes the image
fetch and the parser entirely while still telling you what was sent. The
whitelist lets a handful of trusted emotes through without opening the door to
all of them.

### Hide profile pictures  -- default: ON
Hides all user avatars everywhere via injected CSS, *except* for users you
explicitly trust. Put their numeric **user IDs** in the **Profile picture
whitelist** and only their avatars are shown; everyone else stays blank.
(IDs are matched against the avatar's CDN URL, so a user on a default avatar with
no custom image cannot be whitelisted.)

**Why:** Avatars are a stream of attacker-supplied images decoded by your client
-- a malicious-image-payload and load-time-tracking surface. On by default
because it is the same class of risk as emotes. The whitelist means the people
who matter still have a face, while the rest of the world does not get to send
your client an image at all.

### Voice bandpass filter  -- default: ON, 80 Hz - 15 kHz, adjustable
Both your microphone *and* incoming voice audio are routed through a
highpass + lowpass biquad chain. Cutoffs are adjustable in Settings and apply
live to active calls.

**Why:** Human speech lives roughly in this band. Energy outside it is, at best,
useless, and at worst a carrier for side-channel content. Clamping the band
keeps voice intelligible while throwing away the parts of the spectrum an
attacker would actually want.

**The APT angle -- acoustic infiltration and exfiltration.** Advanced
Persistent Threats have shown (in research and in the wild) that sound is a
usable, covert network -- one that crosses air gaps no firewall can see.
Near-ultrasonic and ultrasonic tones (roughly 17 kHz and up) are inaudible to
most adults but carry data just fine between ordinary consumer hardware. Three
facts make this worse than it first sounds:

- **Almost everything around you has a speaker** -- your monitor, your phone,
  your headset, laptops, smart-home and embedded gadgets, other PCs. Each one is
  a potential transmitter that can emit tones you will never hear.
- **A speaker is also a (poor) microphone.** A loudspeaker is just a diaphragm
  on a coil; drive it and it makes sound, vibrate it with sound and it generates
  a small signal. Reversible. So devices you think of as output-only -- a
  monitor's speakers, a phone resting face-down, an embedded panel -- can be
  coerced into *listening*. Infiltration (data sent *to* a machine) and
  exfiltration (data pulled *off* it) can both ride this channel, in either
  direction, between devices that share no network at all.
- **Discord is a live, full-duplex audio pipe to the open internet.** That makes
  your client an ideal courier: malware on a nearby air-gapped or embedded device
  chirps ultrasonically, your mic picks it up, and Discord faithfully streams it
  out to whoever is on the call -- or the reverse, an incoming stream carries
  inaudible tones your speakers replay into the room to command a device sitting
  next to you. Your headset becomes the last hop of someone else's covert link.

The bandpass is the cut that closes this door. Voice does not need anything
above ~15 kHz, so the default high cutoff throws the entire near-ultrasonic and
ultrasonic band away on **both** legs -- your outgoing mic feed and the incoming
audio your speakers play -- before either can carry a hidden payload past you.
If you want to be stricter, drop the high cutoff further (12 kHz is still
perfectly intelligible for speech); it costs you nothing and starves the channel
even more. This is also why the filter is applied to incoming audio and not just
your mic: a courier you only guard in one direction is not guarded at all.

---

## A threat vector I think about: your mouse, through your microphone

This is hypothetical, but it has been demonstrated in the wild, so I will not
pretend it away.

A computer mouse reports its position at a fixed **polling rate** (125 Hz up to
8000 Hz on modern gaming mice). That polling is a periodic electrical signal,
and a mouse is a cheap peripheral -- **poorly shielded, if shielded at all.**
Its USB cable, its internal traces, and the host's USB bus all radiate. When an
unshielded microphone (or its cable, or its preamp) sits close by, that periodic
interference can **couple into the audio path** -- bleeding a tone, and the
modulation riding on it, into what your mic captures and transmits.

The unsettling part: your mouse movements are correlated with what you are
doing. A motivated listener analyzing your outgoing audio could, in principle,
pull a faint, structured artifact out of it that tracks your cursor -- a leak you
never spoke.

**How this patchset and your habits push back:**

1. **Bandpass first.** High polling rates put their fundamental and harmonics
   well above the voice band. The default 80 Hz - 15 kHz filter already attenuates
   a lot of that. If you suspect bleed, **tighten the band** -- pull the high
   cutoff down toward 12 kHz or lower, and the low cutoff up toward 120 Hz -- to
   carve out whatever interference tone you can identify. The cutoffs are there
   to be tuned, not admired.

2. **Lower your mouse polling rate for everyday use.** 125-250 Hz is plenty for
   browsing, chatting, and working, and it drops the interference fundamental
   down where it is easier to handle (and produces far less harmonic energy up
   the spectrum). Most mouse software and many Linux tools let you set this.

3. **Only raise the polling rate when you are actually gaming**, then drop it
   back down. Treat 1000-8000 Hz as a tool you pick up for the task and put away
   after -- not a thing left running while you are on a call.

4. Physically, if you can: keep the mouse and its cable away from the mic and
   mic cable, and use a shielded/balanced mic where possible. The filter is the
   last line; distance and shielding are the first.

5. **Keep a messy desk.** This sounds like a joke. It is not. Coupling like this
   falls off fast with distance and is wrecked by anything that adds separation
   or breaks a clean, repeatable cable geometry. A cluttered desk -- cables
   routed chaotically, the mouse and mic buried among other objects, nothing
   sitting in a tidy fixed arrangement -- raises the average distance between the
   noisy peripheral and the mic, randomizes their relative position from session
   to session, and litters the EM environment with other conductors that absorb
   and scatter stray fields. A neat, minimalist setup with the mouse parked
   inches from an exposed mic on a bare surface is the *ideal* case for the
   attacker. Deny them that. Let it be a mess. I find the chaos comforting
   anyway -- it means no one has been here arranging your things.

None of this is a guarantee. It is layered odds-shifting -- which is the whole
spirit of this fork. I cannot make the world safe. I can make it very, very hard
for anything you didn't ask for to reach you.

---

## Installation

This fork does not publish prebuilt binaries. The mitigations are compiled in
(the Privacy tab and its defaults live in the app's settings schema), so you
install it by building it yourself. You need [Bun](https://bun.sh) and `git`.

```
git clone https://github.com/japaneseenrichmentorganization/GoofCord.git
cd GoofCord
bun install
```

**Run it directly** (builds a dev version and launches):

```
bun run start
```

**Build an installable app** for your platform (output lands in `dist/`):

```
bun run packageLinux      # or: packageWindows / packageMac
```

Then install/run the produced artifact like any normal desktop app.

> Note on staying current: the renderer mitigations
> (`assets/preVencord.js` / `assets/postVencord.js`) are fetched at runtime from
> this repository's `main` branch by default, so once installed the client keeps
> those parts up to date on its own. The compiled-in parts (the Privacy tab, the
> default values) only change when you rebuild from a newer source.

## Usage

1. Open **Settings** (the GoofCord cog / tray menu) and go to the **Privacy**
   tab. A warning banner explains that these are aggressive mitigations that will
   change how Discord behaves on purpose.
2. The aggressive options -- ASCII-only names, ASCII-only messages, disable
   emotes, hide profile pictures, and the voice bandpass -- are **ON by default**.
   Untick anything you do not want. Some toggles say "reload to fully apply";
   `Ctrl+R` reloads Discord.

**Letting specific people or emotes through the filters:**

- Turn on Discord's **Developer Mode**: User Settings -> Advanced -> Developer
  Mode. Then right-click a user and choose **Copy User ID** -- paste that number
  into the **Profile picture whitelist** to keep that person's avatar visible.
- For an **emote ID**, type a backslash before the emote in the message box
  (e.g. `\:smile:`) and send it: the message reveals the raw `<:smile:123456>`
  form. The trailing number is the emote ID -- paste it into the **Emote
  whitelist** to keep that emote visible as an image.
- Whitelists accept **numbers only**; non-numeric entries are ignored.

**Tuning the voice bandpass:** the low/high cutoffs (default 80 Hz / 15000 Hz)
are textfields under the bandpass toggle. Cutoff changes apply live to an active
call; see the mouse/microphone section above for when you might tighten them.

## Developing

```
bun run start      # dev build + launch
bun run build      # generators + typecheck + bundle renderer assets
bun run lint       # oxlint --type-aware
bun run check      # typecheck only
```

The Privacy features live in:

- `src/windows/main/renderer/postVencord/contentFilters.ts` -- names, messages, emotes, avatars, and their whitelists
- `src/windows/main/renderer/preVencord/audioBandpass.ts` -- mic + incoming voice bandpass
- `src/settingsSchema.ts` -- the Privacy category and defaults
- `src/migration.ts` -- repoints stored asset URLs to this fork

After changing renderer code, commit and push so the runtime asset downloader
fetches the updated `assets/preVencord.js` / `assets/postVencord.js` from this
repo. For local iteration without pushing, point the External Assets entries at
absolute local paths instead.

---

## Credit

Built on [GoofCord](https://github.com/Milkshiift/GoofCord) by MilkShift, which
is itself based on [Legcord](https://github.com/Legcord/Legcord). All upstream
licensing (OSL-3.0) applies. This fork only adds the hardening patchset
described above.
