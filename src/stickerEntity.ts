import { SavedBot } from "./botEntity"
import { EnvBindings } from "./env"

export interface SavedSticker {
	id: string
	file_id: string
	file_size: number
	width: number
	height: number
	set_name?: string
	is_animated: boolean
	is_video: boolean
	type: 'regular' | 'mask' | 'custom_emoji'
	tokens: string[]
}

export interface SavedStickerMetadata {
	file_id: string
	tokens: string[]
}

export async function saveSticker(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker) {
  console.log(`Saving sticker ${sticker.id}`)
  await env.STICKERS.put(`sticker/${savedBot.id}/${sticker.id}`, JSON.stringify(sticker), {
    metadata: {
      file_id: sticker.file_id,
      tokens: sticker.tokens
    }
  })
}

export async function deleteSticker(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker) {
  console.log(`Deleting sticker ${sticker.id}`)
  await env.STICKERS.delete(`sticker/${savedBot.id}/${sticker.id}`);
}

export async function findSticker(savedBot: SavedBot, env: EnvBindings, id: string) : Promise<SavedSticker | null> {
  let sticker = await env.STICKERS.get<SavedSticker>(`sticker/${savedBot.id}/${id}`, 'json');
  if (sticker) {
    console.log(`Found sticker ${id} under bot ${savedBot.id}`);
  } else {
    console.log(`Did not find sticker ${id} under bot ${savedBot.id}`);
  }
  return sticker;
}
