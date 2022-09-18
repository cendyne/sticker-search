import {EnvBindings} from './env'
import {SavedBot} from './botEntity'
import { SavedSticker } from './stickerEntity'
import { TelegramStickerSet } from './telegram'
export interface OwnerStateNone {
	state: 'none'
}
export interface OwnerStateSingleSticker {
	state: 'single_sticker'
	sticker: SavedSticker
}
export interface OwnerStateLearnSingleSticker {
	state: 'learn_single_sticker'
	sticker: SavedSticker
}
export interface OwnerStateLearnStickerPack {
	state: 'learn_sticker_pack'
	sticker: SavedSticker
	set: TelegramStickerSet
	sticker_index: number
}
export interface OwnerStateRedoStickerPack {
	state: 'relearn_sticker_pack'
	sticker: SavedSticker
	set: TelegramStickerSet
	sticker_index: number
}

export type OwnerState = OwnerStateNone
	| OwnerStateSingleSticker
	| OwnerStateLearnSingleSticker
	| OwnerStateLearnStickerPack
  | OwnerStateRedoStickerPack

export async function stateNone(savedBot: SavedBot, env: EnvBindings) {
	let state : OwnerStateNone = {
		state: 'none'
	};
	await env.STICKERS.put(`state/${savedBot.owner}`, JSON.stringify(state));
}
export async function stateSingleSticker(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker) {
	let state : OwnerStateSingleSticker = {
		state: 'single_sticker',
		sticker
	};
	await env.STICKERS.put(`state/${savedBot.owner}`, JSON.stringify(state));
}
export async function stateLearnSingleSticker(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker) {
	let state : OwnerStateLearnSingleSticker = {
		state: 'learn_single_sticker',
		sticker
	};
	await env.STICKERS.put(`state/${savedBot.owner}`, JSON.stringify(state));
}
export async function stateLearnStickerPack(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker, sticker_index: number, set: TelegramStickerSet) {
	let state : OwnerStateLearnStickerPack = {
		state: 'learn_sticker_pack',
		sticker,
		sticker_index,
		set
	};
	await env.STICKERS.put(`state/${savedBot.owner}`, JSON.stringify(state));
}
export async function stateRelearnStickerPack(savedBot: SavedBot, env: EnvBindings, sticker: SavedSticker, sticker_index: number, set: TelegramStickerSet) {
	let state : OwnerStateRedoStickerPack = {
		state: 'relearn_sticker_pack',
		sticker,
		sticker_index,
		set
	};
	await env.STICKERS.put(`state/${savedBot.owner}`, JSON.stringify(state));
}
export async function getState(savedBot: SavedBot, env: EnvBindings) : Promise<OwnerState> {
	let state = await env.STICKERS.get<OwnerState>(`state/${savedBot.owner}`, 'json');
	if (!state) {
		return {
			state: 'none'
		};
	}
	return state;
}
