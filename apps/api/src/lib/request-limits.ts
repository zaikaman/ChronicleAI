/** Application-level limits for untrusted HTTP input. */

/** Maximum decoded JSON request body accepted by the API parser. */
export const MAX_JSON_BODY_SIZE = "1mb";

/** Maximum current-turn text accepted by the affiliate payout agent. */
export const MAX_AFFILIATE_AGENT_MESSAGE_CHARS = 8_192;

/** Maximum number of prior turns accepted by the affiliate payout agent. */
export const MAX_AFFILIATE_AGENT_HISTORY_MESSAGES = 12;

/** Maximum text size for one prior affiliate-agent turn. */
export const MAX_AFFILIATE_AGENT_HISTORY_MESSAGE_CHARS = 8_192;

/** Maximum combined text size for prior affiliate-agent turns. */
export const MAX_AFFILIATE_AGENT_HISTORY_CHARS = 32_768;
