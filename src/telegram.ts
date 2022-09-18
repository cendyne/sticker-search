import { SavedBot } from "./botEntity"

export interface TelegramFrom {
	id: number
			first_name: string
			username: string
}
export interface TelegramPhotoSize {
	file_id: string
	file_unique_id: string
	file_size: number
	width: number
	height: number
}
export interface TelegramSticker {
	width: number
	height: number
	emoji: string
	set_name: string
	is_animated: boolean
	is_video: boolean
	type: 'regular' | 'mask' | 'custom_emoji'
	file_id: string
	file_unique_id: string
	file_size: number
	thumb: TelegramPhotoSize
}

export interface TelegramStickerSet {
	name: string
	title: string
	sticker_type: 'regular' | 'mask' | 'emoji'
	is_animated: boolean
	is_video: boolean
	stickers: TelegramSticker[]
	thumb: TelegramPhotoSize
}
export interface TelegramMessage {
  message_id: number
  from: TelegramFrom,
  chat: {
    id: number
    type: string
  },
  date: number
  text?: string
  sticker?: TelegramSticker
}
export interface TelegramInlineQuery {
  id: string,
  from: TelegramFrom,
  chat_type: 'sender' | 'channel' | 'private' | 'group' | 'supergroup',
  query: string,
  offset: string
}
export interface TelegramUpdate {
	update_id: number
	message?: TelegramMessage
	inline_query?: TelegramInlineQuery
}

export interface TelegramResponse<E> {
	ok: boolean
	result: E
}
export interface GetMeResponse {
	id: number
	is_bot: boolean
	first_name: string
	username: string
	can_join_groups: boolean
	can_read_all_group_messages: boolean
	supports_inline_queries: boolean
}

export async function sendMessage(savedBot: SavedBot, chat_id: number, text: string) {
  console.log("Responding with", text);
	let response = await fetch(`https://api.telegram.org/bot${savedBot.apiKey}/sendMessage`, {
		body: JSON.stringify({
			chat_id,
			text,
      parse_mode: 'HTML'
		}),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST'
	});
  if (response.status != 200) {
    console.error(await response.text());
  }
}

export async function sendSticker(savedBot: SavedBot, chat_id: number, file_id: string) {
  await fetch(`https://api.telegram.org/bot${savedBot.apiKey}/sendSticker`, {
		body: JSON.stringify({
			chat_id,
			sticker: file_id,
		}),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST'
	});
}

export async function getStickerSet(savedBot : SavedBot, name: string) : Promise<TelegramResponse<TelegramStickerSet>> {
	let response = await fetch(`https://api.telegram.org/bot${savedBot.apiKey}/getStickerSet`, {
		body: JSON.stringify({
			name
		}),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST'
	});
	return await response.json<TelegramResponse<TelegramStickerSet>>();
}

export async function callbackStickers(savedBot : SavedBot, inline_query_id: string, stickers: {file_id: string}[], continuation?: string) {
	let body : any = {
		inline_query_id,
		results: stickers.map(sticker => {
			return {
				type: 'sticker',
				id: crypto.randomUUID(),
				sticker_file_id: sticker.file_id
			}
		})
	};
	if (continuation) {
		body.next_offset = continuation;
	}
	console.log(`Replying with ${body.results.length} stickers`)
	let response = await fetch(`https://api.telegram.org/bot${savedBot.apiKey}/answerInlineQuery`, {
		body: JSON.stringify(body),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST'
	});
	if (response.status != 200) {
		console.error(await response.text())
	}
}
