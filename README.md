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

**Why:** Emotes are remote images fetched from a CDN -- a tracking beacon and an
image-decoder attack surface in one. Reducing them to text removes the image
fetch and the parser entirely while still telling you what was sent.

### Hide profile pictures  -- default: OFF
Hides all user avatars everywhere via injected CSS.

**Why:** Avatars are another stream of attacker-supplied images decoded by your
client. Defense-in-depth against malicious image payloads and load-time
tracking. Off by default because for most people the risk/annoyance trade isn't
worth it -- but it's one click away when you want the blast doors down.

### Block everyone (whitelist mode)  -- default: OFF
When on, messages and typing indicators from everyone except whitelisted user
IDs are dropped. Your own messages always show. IDs go in the **User whitelist**
list.

**Why:** The strongest mitigation is not seeing untrusted input at all. This is
for when you only want the handful of people who matter, and the rest of the
world can shout into a void.

### Voice bandpass filter  -- default: ON, 80 Hz - 15 kHz, adjustable
Both your microphone *and* incoming voice audio are routed through a
highpass + lowpass biquad chain. Cutoffs are adjustable in Settings and apply
live to active calls.

**Why:** Human speech lives roughly in this band. Energy outside it is, at best,
useless, and at worst a carrier for side-channel content (see the threat vector
below). Clamping the band keeps voice intelligible while throwing away the parts
of the spectrum an attacker would actually want.

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

## Build

This fork builds with [Bun](https://bun.sh):

```
bun install
bun run build      # generators + typecheck + bundle renderer assets
bun run start      # dev build + launch
bun run lint       # oxlint --type-aware
```

The Privacy features live in:

- `src/windows/main/renderer/postVencord/contentFilters.ts` -- names, messages, emotes, avatars, whitelist
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
