// Content filters:
// - ASCII-only names: names containing non-ASCII characters are replaced with the user's Discord ID
// - ASCII-only messages: hide messages whose text contains non-ASCII characters
// - Disable emotes: hide emote images, with an optional per-emote-ID whitelist
// - Hide profile pictures: hide all avatars, with an optional per-user-ID whitelist

const NON_ASCII = /[^\x20-\x7E]/;
const AVATAR_STYLE_ID = "goofcord-hide-avatars";
const EMOTE_STYLE_ID = "goofcord-text-emotes";
// <:name:123> and <a:name:123> custom emotes -> capture name and id separately
const CUSTOM_EMOTE = /<a?:([^:<>]+):(\d+)>/g;
// Snowflake IDs are numeric. Whitelist entries are injected into CSS selectors,
// so we hard-restrict them to digits to make CSS injection impossible.
const NUMERIC_ID = /^\d+$/;

let asciiOnlyNames = false;
let disableEmotes = false;
let asciiOnlyMessages = false;
let hideAvatars = false;
let emoteWhitelist = new Set<string>();
let avatarWhitelist: string[] = [];

let storesPatched = false;
let dispatchPatched = false;

function sanitizeIdList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string" && NUMERIC_ID.test(v));
}

function loadFilterConfig() {
	asciiOnlyNames = GoofCord.getConfig("asciiOnlyNames");
	disableEmotes = GoofCord.getConfig("disableEmotes");
	asciiOnlyMessages = GoofCord.getConfig("asciiOnlyMessages");
	hideAvatars = GoofCord.getConfig("hideAvatars");
	emoteWhitelist = new Set(sanitizeIdList(GoofCord.getConfig("emoteWhitelist")));
	avatarWhitelist = sanitizeIdList(GoofCord.getConfig("avatarWhitelist"));
}

export function initContentFilters() {
	loadFilterConfig();

	window.goofcord.onFiltersConfigChanged(() => {
		loadFilterConfig();
		applyAvatarStyle();
		applyEmoteStyle();
		patchStoresIfNeeded();
		patchDispatchIfNeeded();
	});

	applyAvatarStyle();
	applyEmoteStyle();
	patchStoresIfNeeded();
	patchDispatchIfNeeded();
}

// --- Disable emotes ---------------------------------------------

// Replace a custom emote token with its name (if plain ASCII) or its numeric ID.
// Whitelisted emote IDs keep their original token so Discord renders the image.
// Operates purely on the message string; no Discord internals are touched.
function emotesToText(content: string): string {
	return content.replace(CUSTOM_EMOTE, (match, name: string, id: string) => {
		if (emoteWhitelist.has(id)) return match;
		return NON_ASCII.test(name) ? id : `:${name}:`;
	});
}

// --- ASCII-only names ---------------------------------------------

function sanitizeUser(user: any) {
	if (!asciiOnlyNames || !user?.id) return user;
	if (typeof user.username === "string" && NON_ASCII.test(user.username)) user.username = user.id;
	if (typeof user.globalName === "string" && NON_ASCII.test(user.globalName)) user.globalName = user.id;
	if (typeof user.global_name === "string" && NON_ASCII.test(user.global_name)) user.global_name = user.id;
	return user;
}

function sanitizeMember(member: any) {
	if (!asciiOnlyNames || !member) return member;
	if (typeof member.nick === "string" && NON_ASCII.test(member.nick)) member.nick = member.userId ?? member.user?.id ?? "";
	return member;
}

function patchStoresIfNeeded() {
	// Patching is one-way: turning the option off mid-session leaves already
	// sanitized store records as IDs until Discord is reloaded.
	if (storesPatched || !asciiOnlyNames) return;
	storesPatched = true;

	const UserStore: any = VC.Webpack.findStore("UserStore");
	const GuildMemberStore: any = VC.Webpack.findStore("GuildMemberStore");

	if (UserStore) {
		const origGetUser = UserStore.getUser;
		UserStore.getUser = function (...args: unknown[]) {
			return sanitizeUser(origGetUser.apply(this, args));
		};

		const origGetUsers = UserStore.getUsers;
		if (origGetUsers) {
			UserStore.getUsers = function (...args: unknown[]) {
				const users = origGetUsers.apply(this, args);
				if (users && asciiOnlyNames) {
					for (const id of Object.keys(users)) sanitizeUser(users[id]);
				}
				return users;
			};
		}
	}

	if (GuildMemberStore) {
		const origGetMember = GuildMemberStore.getMember;
		GuildMemberStore.getMember = function (...args: unknown[]) {
			return sanitizeMember(origGetMember.apply(this, args));
		};

		const origGetNick = GuildMemberStore.getNick;
		if (origGetNick) {
			GuildMemberStore.getNick = function (guildId: string, userId: string) {
				const nick = origGetNick.call(this, guildId, userId);
				if (asciiOnlyNames && typeof nick === "string" && NON_ASCII.test(nick)) return userId;
				return nick;
			};
		}
	}
}

// --- Message sanitization ---------------------------------------------

// Returns false if the message should be hidden (non-ASCII content).
function processMessage(msg: any): boolean {
	if (!msg) return true;
	sanitizeUser(msg.author);
	if (msg.referenced_message) processMessage(msg.referenced_message);
	for (const u of msg.mentions ?? []) sanitizeUser(u);
	if (disableEmotes && typeof msg.content === "string") msg.content = emotesToText(msg.content);
	if (asciiOnlyMessages && typeof msg.content === "string" && NON_ASCII.test(msg.content)) return false;
	return true;
}

function patchDispatchIfNeeded() {
	if (dispatchPatched || (!asciiOnlyNames && !asciiOnlyMessages && !disableEmotes)) return;
	dispatchPatched = true;

	const originalDispatch = Common.FluxDispatcher.dispatch;

	Common.FluxDispatcher.dispatch = function (payload: any) {
		try {
			if (!handleDispatch(payload)) return Promise.resolve();
		} catch (err) {
			console.error("[Content Filters] Error in dispatch handler:", err);
		}
		return originalDispatch.call(this, payload);
	};
}

// Returns false if the whole dispatch should be dropped
function handleDispatch(dispatch: any): boolean {
	switch (dispatch.type) {
		case "MESSAGE_CREATE":
		case "MESSAGE_UPDATE":
			return processMessage(dispatch.message);

		case "LOAD_MESSAGES_SUCCESS":
			if (Array.isArray(dispatch.messages)) {
				dispatch.messages = dispatch.messages.filter((msg: any) => processMessage(msg));
			}
			break;

		case "SEARCH_FINISH":
		case "MOD_VIEW_SEARCH_FINISH":
			if (Array.isArray(dispatch.messages)) {
				dispatch.messages = dispatch.messages.map((group: any) => (Array.isArray(group) ? group.filter((msg: any) => processMessage(msg)) : group)).filter((group: any) => !Array.isArray(group) || group.length > 0);
			}
			break;
	}
	return true;
}

function setStyle(id: string, enabled: boolean, css: string) {
	let style = document.getElementById(id);

	if (!enabled) {
		style?.remove();
		return;
	}

	if (!style) {
		style = document.createElement("style");
		style.id = id;
		document.head.appendChild(style);
	}

	style.textContent = css;
}

// --- Hide profile pictures ---------------------------------------------

function applyAvatarStyle() {
	// Avatar image URLs embed the user ID (.../avatars/<userId>/... and
	// .../guilds/<guildId>/users/<userId>/...), so whitelisting is done by
	// re-showing those specific URLs. IDs are digits-only (see NUMERIC_ID),
	// so this cannot be used to inject arbitrary CSS.
	const overrides = avatarWhitelist
		.map(
			(id) => `
		img[src*="/avatars/${id}/"],
		img[src*="/users/${id}/avatars/"] {
			visibility: visible !important;
		}`,
		)
		.join("\n");

	setStyle(
		AVATAR_STYLE_ID,
		hideAvatars,
		`
		img[class*="avatar"],
		svg[class*="avatar"] foreignObject img,
		img[src*="cdn.discordapp.com/avatars/"],
		img[src*="cdn.discordapp.com/guilds/"][src*="/users/"],
		img[src*="cdn.discordapp.com/embed/avatars/"],
		div[class*="avatar"][style*="background-image"] {
			visibility: hidden !important;
		}
		${overrides}
	`,
	);
}

// Safety net for emote images the data-level conversion cannot reach
// (already-rendered messages, embeds) and emote reactions under messages.
// Whitelisted emote IDs are re-shown by their CDN URL (.../emojis/<id>.*).
function applyEmoteStyle() {
	const overrides = [...emoteWhitelist]
		.map(
			(id) => `
		img[src*="/emojis/${id}."] {
			display: revert !important;
		}`,
		)
		.join("\n");

	setStyle(
		EMOTE_STYLE_ID,
		disableEmotes,
		`
		img[class*="emoji"],
		img[src*="cdn.discordapp.com/emojis/"],
		div[class*="reactions"] {
			display: none !important;
		}
		${overrides}
	`,
	);
}
