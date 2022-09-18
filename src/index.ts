import { Env, EnvBindings } from "./env";



import { Hono } from 'hono'
import { SavedBot } from "./botEntity";
import {getState, stateLearnSingleSticker, stateLearnStickerPack, stateNone, stateRelearnStickerPack, stateSingleSticker} from './state';
import { deleteSticker, findSticker, SavedSticker, SavedStickerMetadata, saveSticker } from "./stickerEntity";
import { callbackStickers, GetMeResponse, getStickerSet, sendMessage, sendSticker, TelegramInlineQuery, TelegramMessage, TelegramResponse, TelegramSticker, TelegramUpdate } from "./telegram";
const app = new Hono<Env>()

app.get('/', async (c) => {
	return c.text('Message @Cendyne for instructions');
});

interface RegisterRequest {
	apiKey: string
}



app.put('/register', async (c) => {
	let registerRequest = await c.req.json<RegisterRequest>();
	if (!registerRequest.apiKey) {
		return c.json({
			error: 'Missing apiKey'
		}, 400);
	} else if (!registerRequest.apiKey.match(/\d+:[A-Za-z0-9\-_]+/)){
		return c.json({
			error: 'apiKey looks incorrect, expected to start with a number'
		}, 400);
	}
	let apiKey = registerRequest.apiKey;
	let getMeRes = await fetch(`https://api.telegram.org/bot${apiKey}/getMe`);
	let getMe = await getMeRes.json<TelegramResponse<GetMeResponse>>();
	if (!getMe.ok) {
		console.log('Failed login', getMe);
		return c.json({
			error: 'apiKey looks incorrect, telegram did not respond well'
		}, 400);
	}
	if (getMe.result.can_join_groups) {
		return c.json({
			error: `Please disable @${getMe.result.username}'s ability to join groups`
		}, 400);
	}
	if (getMe.result.can_read_all_group_messages) {
		return c.json({
			error: `Please disable @${getMe.result.username}'s ability to read all messages`
		}, 400);
	}
	if (!getMe.result.supports_inline_queries) {
		return c.json({
			error: `Please enable @${getMe.result.username}'s ability to use inline queries`
		}, 400);
	}

	let savedBot = await c.env.STICKERS.get<SavedBot>(`bots/${getMe.result.id}`, 'json');
	let webhookKey = crypto.randomUUID();
	if (!savedBot) {
		let owningKey = crypto.randomUUID();
		savedBot = {
			apiKey,
			id: getMe.result.id,
			username: getMe.result.username,
			owningKey,
			webhookKey,
		};
	} else {
		savedBot.apiKey = apiKey;
		savedBot.webhookKey = webhookKey;
	}
	let url = new URL(c.req.url);
	await c.env.STICKERS.put(`bots/${getMe.result.id}`, JSON.stringify(savedBot));

	let setWebhookRes = await fetch(`https://api.telegram.org/bot${apiKey}/setWebhook`, {
		body: JSON.stringify({
			url: `https://${url.host}/webhook/${getMe.result.id}`,
			secret_token: webhookKey,
			drop_pending_updates: true,
			allowed_updates: ['message', 'inline_query']
		}),
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST'
	});
	console.log(await setWebhookRes.json());
	return c.json({
		message: `@${getMe.result.username} is registered, ${!savedBot.owner ? `you need to associate it to your telegram account by messaging it with <code>/register ${savedBot.owningKey}</code>` : 'it is already associated to a telegram account'}`
	});

})



function stickerFromTelegramSticker(telegramSticker: TelegramSticker): SavedSticker {
	return {
		id: telegramSticker.file_unique_id,
		file_id: telegramSticker.file_id,
		file_size: telegramSticker.file_size,
		height: telegramSticker.height,
		width: telegramSticker.width,
		is_animated: telegramSticker.is_animated,
		is_video: telegramSticker.is_video,
		set_name: telegramSticker.set_name,
		tokens: [],
		type: telegramSticker.type
	}
}




function findTokens(text: string) : string[]{
	return text.toLowerCase().split(' ').sort()
	.map(token => {
		// remove punctuation
		return token.replaceAll(/[^a-z0-9]/g, '');
	})
	// Remove empty tokens
	.filter(token => token.length > 0);
}

interface StickerQueryResult {
	stickers: {
		file_id: string
		score: number
	}[]
}

async function findStickers(savedBot: SavedBot, env: EnvBindings, query: string): Promise<StickerQueryResult> {
	let tokens = findTokens(query);
	let stickers : {file_id: string, score: number}[] = [];
	let continuation = null;
	let nsfw = false;
	if (tokens.includes('nsfw')) {
		nsfw = true;
		tokens = tokens.filter(x => x != 'nsfw');
	}
	console.log(`Searching for nsfw?:${nsfw} ${tokens.join(' ')}`);
	do {
		let list: KVNamespaceListResult<SavedStickerMetadata> = await env.STICKERS.list<SavedStickerMetadata>({
			prefix: `sticker/${savedBot.id}/`,
			cursor: continuation
		});
		if (list.cursor && !list.list_complete) {
			continuation = list.cursor;
		} else {
			continuation = null;
		}
		for (let sticker of list.keys) {
			if (sticker.metadata) {
				let score = 0;
				if (tokens.length > 0) {
					let foundNsfw = false;
					for (let token of sticker.metadata.tokens) {
						if (token == 'nsfw' && !nsfw) {
							score = -1000;
							break;
						}
						if (token == 'nsfw') {
							foundNsfw = true;
						}
						for (let searchToken of tokens) {
							if (token == searchToken) {
								score += 1;
							} else if (token.startsWith(searchToken)) {
								score += searchToken.length / token.length;
							} else if (token.includes(searchToken)) {
								score += 0.8 * (searchToken.length / token.length);
							}
						}
					}
					if (nsfw && !foundNsfw) {
						score = -1000;
						continue;
					}
					if (score > 0) {
						score = score / tokens.length;
					}
				} else {
					let includesNsfw = sticker.metadata.tokens.includes('nsfw');
					if (includesNsfw && nsfw) {
						score = 1
					} else if (includesNsfw && !nsfw) {
						score = 0;
					} else if (nsfw && !includesNsfw) {
						score = 0;
					} else {
						score = 1;
					}
				}

				if (score > 0) {
					stickers.push({
						file_id: sticker.metadata.file_id,
						score
					})
				}
			}
		}
	} while (continuation);
	stickers.sort((a, b) => a.score - b.score);
	return {
		stickers
	};
}

async function handleRegister(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	if (!message.text) {
		console.error('handle register called without message text');
		return;
	}
	let token = message.text.slice('/register '.length).trim();
	if (token == savedBot.owningKey) {
		savedBot.owner = message.chat.id;
		await env.STICKERS.put(`bots/${id}`, JSON.stringify(savedBot));
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, "You are now registered as the owner!"));
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, "This key is not correct"));
	}
}
async function handleLearnSticker(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state == 'single_sticker') {
		await stateLearnSingleSticker(savedBot, env, state.sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'For your next message, send all the terms you would like this sticker to be searchable with'));
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused.'));
	}
}
async function handleForgetSticker(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state == 'single_sticker') {
		await stateNone(savedBot, env);
		await deleteSticker(savedBot, env, state.sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Forgetting this one!'));
	} else if (state.state == 'learn_sticker_pack') {
		await deleteSticker(savedBot, env, state.sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Forgetting this one!'));
		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			console.log('Looking for', state.set.stickers[index].file_unique_id);
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				// Hooray found the next one!
				let nextSticker = stickerFromTelegramSticker(state.set.stickers[index]);
				await stateLearnStickerPack(savedBot, env, nextSticker, index, state.set);
				await presentSticker(savedBot, message, nextSticker);
				return;
			}
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'All done! Send another sticker when ever you are ready.'));
		await stateNone(savedBot, env);
		return;
	} else if (state.state == 'relearn_sticker_pack') {
		await deleteSticker(savedBot, env, state.sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Forgetting this one!'));
		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				foundSticker = stickerFromTelegramSticker(state.set.stickers[index]);
			}
			await stateRelearnStickerPack(savedBot, env, foundSticker, index, state.set);
			await presentSticker(savedBot, message, foundSticker);
			return;
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'All done! Send another sticker when ever you are ready.'));
		await stateNone(savedBot, env);
		return;
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused.'));
	}
}

async function presentSticker(savedBot: SavedBot, message: TelegramMessage, sticker: SavedSticker) {
	await sendSticker(savedBot, message.chat.id, sticker.file_id);
	let messageText = 'For your next message, send all the terms you would like this sticker to be searchable with!\nIf you want to skip this sticker and continue in the pack, use /skip\nIf you want to cancel out of this pack, use /cancel';
	if (sticker.tokens.length > 0) {
		messageText += `\nThis sticker may be searched with the following terms: <code>${sticker.tokens.join(' ')}</code>\nYour next message will replace all search terms.`
	}
	await sendMessage(savedBot, message.chat.id, messageText);
}

async function handleSkipSticker(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state == 'learn_sticker_pack') {
		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			console.log('Looking for', state.set.stickers[index].file_unique_id);
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				// Hooray found the next one!
				let nextSticker = stickerFromTelegramSticker(state.set.stickers[index]);
				console.log(`Presenting ${nextSticker.id} to user`);
				await stateLearnStickerPack(savedBot, env, nextSticker, index, state.set);
				await presentSticker(savedBot, message, nextSticker);
				return;
			}
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'All done! Send another sticker when ever you are ready.'));
		await stateNone(savedBot, env);
		return;
	} else if (state.state == 'relearn_sticker_pack') {
		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				foundSticker = stickerFromTelegramSticker(state.set.stickers[index]);
			}
			await stateRelearnStickerPack(savedBot, env, foundSticker, index, state.set);
			await presentSticker(savedBot, message, foundSticker);
			return;
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'All done! Send another sticker when ever you are ready.'));
		await stateNone(savedBot, env);
		return;
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused.'));
	}
}

async function handleLearnPack(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state == 'single_sticker') {
		let sticker = state.sticker;
		if (!sticker.set_name) {
			executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'This sticker is not part of a pack so this command will not work.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
			return;
		}
		let setResponse = await getStickerSet(savedBot, sticker.set_name);
		if (!setResponse.ok) {
			executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'There was an error loading the sticker pack.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
			return;
		}
		let set = setResponse.result;
		for (let index = 0; index < set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, set.stickers[index].file_unique_id);
			if (!foundSticker) {
				// Hooray! We found one to learn
				let nextSticker = stickerFromTelegramSticker(set.stickers[index]);
				console.log(`Presenting ${nextSticker.id} to user`);
				await stateLearnStickerPack(savedBot, env, nextSticker, index, set);
				await presentSticker(savedBot, message, nextSticker);
				return;
			}
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Every sticker has already been learned. If you would like to redo the pack, consider the /relearn_pack command after sending another sticker.'));
		await stateNone(savedBot, env);
		return;
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused. Use /cancel to back out.'));
	}
}

async function handleInlineQuery(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, inlineQuery: TelegramInlineQuery) {
	let stickers = await findStickers(savedBot, env, inlineQuery.query);
	if (stickers.stickers.length > 0) {
		let offset = 0;
		if (inlineQuery.offset) {
			offset = Number.parseInt(inlineQuery.offset);
		}
		let response = stickers.stickers.slice(offset, offset + 50);
		if (response.length == 50) {
			await callbackStickers(savedBot, inlineQuery.id, response, `${offset + 50}`);
		} else {
			await callbackStickers(savedBot, inlineQuery.id, response);
		}

	} else {
		console.log('No response for :', inlineQuery.query);
		await callbackStickers(savedBot, inlineQuery.id, []);
	}
}

async function handleAuthenticatedMessage(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	if (!message.text) {
		console.error('Authenticated message handler called without text')
		return;
	}
	// A normal authenticated text message
	let state = await getState(savedBot, env);
	if (state.state == 'learn_single_sticker') {
		let tokens = findTokens(message.text);
		let sticker = state.sticker;
		sticker.tokens = tokens;
		await saveSticker(savedBot, env, sticker);
		await stateNone(savedBot, env);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Success'));
	} else if (state.state == 'learn_sticker_pack') {
		let tokens = findTokens(message.text);
		let sticker = state.sticker;
		sticker.tokens = tokens;
		await saveSticker(savedBot, env, sticker);

		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				// Hooray found the next one!
				let nextSticker = stickerFromTelegramSticker(state.set.stickers[index]);
				await stateLearnStickerPack(savedBot, env, nextSticker, index, state.set);
				await presentSticker(savedBot, message, nextSticker);
				return;
			}
		}

		await stateNone(savedBot, env);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Every sticker has been learned. To do something else send a new sticker!'));

		return;
	} else if (state.state == 'relearn_sticker_pack') {
		let tokens = findTokens(message.text);
		let sticker = state.sticker;
		sticker.tokens = tokens;
		await saveSticker(savedBot, env, sticker);

		for (let index = state.sticker_index + 1; index < state.set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, state.set.stickers[index].file_unique_id);
			if (!foundSticker) {
				foundSticker = stickerFromTelegramSticker(state.set.stickers[index]);
			}
			await stateRelearnStickerPack(savedBot, env, foundSticker, index, state.set);
			await presentSticker(savedBot, message, foundSticker);
			return;
		}

		await stateNone(savedBot, env);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Every sticker has been learned. To do something else send a new sticker!'));
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused.'));
	}
}

async function handleUnauthenticatedMessage(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, `I only respond direct messages from my owner. The correct way to use this bot is to type my username (@${savedBot.username}) in a chat with someone else and then select the stickers which show up in a menu that loads. You may also use search terms to filter the results. If you would like your own bot like this, message @Cendyne`));
}

async function handleStickerMessage(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	if (!message.sticker) {
		console.error('Handle sticker message called without a sticker');
		return;
	}
	let state = await getState(savedBot, env);
	let sticker_id = message.sticker.file_unique_id;
	let sticker = await findSticker(savedBot, env, sticker_id);
	if (!sticker) {
		sticker = stickerFromTelegramSticker(message.sticker);
	}
	let messageText = 'What would you like to do with this sticker?\n/learn_sticker for just this sticker\n/learn_pack to learn unknown stickers from this pack\n/relearn_pack to learn every sticker from this pack\n/forget_sticker to remove this sticker from future results\n/forget_pack remove every sticker in this sticker pack\n/cancel to back out of this';
	if (sticker.tokens.length > 0) {
		messageText += `\nThis sticker may be searched with the following terms: <code>${sticker.tokens.join(' ')}</code>`
	}

	if (state.state == 'none') {
		await stateSingleSticker(savedBot, env, sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, messageText));
	} else if (state.state == 'single_sticker') {
		// They switched to another sticker
		await stateSingleSticker(savedBot, env, sticker);
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, messageText));
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused, use /cancel to back out'));
	}
}

async function handleCancel(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	await stateNone(savedBot, env);
	executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'Resetting for now.'));
}

async function handleForgetPack(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state != 'single_sticker') {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused, use /cancel to back out'));
		return;
	}

	let sticker = state.sticker;
	if (!sticker.set_name) {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'This sticker is not part of a pack so this command will not work.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
		return;
	}
	let setResponse = await getStickerSet(savedBot, sticker.set_name);
	if (!setResponse.ok) {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'There was an error loading the sticker pack.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
		return;
	}
	let set = setResponse.result;
	let deletions = 0;
	for (let index = 0; index < set.stickers.length; index++) {
		let foundSticker = await findSticker(savedBot, env, set.stickers[index].file_unique_id);
		if (foundSticker) {
			executionCtx.waitUntil(deleteSticker(savedBot, env, foundSticker));
			deletions++;
		}
	}
	executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, `Forget pack successful: ${deletions} stickers were forgotten. Send a new sticker when ever you are ready.`));
	await stateNone(savedBot, env);
}

async function handleRelearnPack(savedBot: SavedBot, env: EnvBindings, executionCtx: ExecutionContext, id: string, message: TelegramMessage) {
	let state = await getState(savedBot, env);
	if (state.state == 'single_sticker') {
		let sticker = state.sticker;
		if (!sticker.set_name) {
			executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'This sticker is not part of a pack so this command will not work.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
			return;
		}
		let setResponse = await getStickerSet(savedBot, sticker.set_name);
		if (!setResponse.ok) {
			executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'There was an error loading the sticker pack.\nUse /cancel to back out. Otherwise refer to the other commands above.'));
			return;
		}
		let set = setResponse.result;
		for (let index = 0; index < set.stickers.length; index++) {
			let foundSticker = await findSticker(savedBot, env, set.stickers[index].file_unique_id);
			if (!foundSticker) {
				foundSticker = stickerFromTelegramSticker(set.stickers[index]);
			}
			await stateRelearnStickerPack(savedBot, env, foundSticker, index, set);
			await presentSticker(savedBot, message, foundSticker);
			return
		}
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'For some reason no stickers were found in this pack. Backing out. Send a new sticker when ready.'));
		await stateNone(savedBot, env);
		return;
	} else {
		executionCtx.waitUntil(sendMessage(savedBot, message.chat.id, 'I am confused. Use /cancel to back out.'));
	}
}

async function handleWebhookAsync(savedBot: SavedBot, json: TelegramUpdate, env: EnvBindings, executionCtx: ExecutionContext, id: string) {
	if (json.message) {
		if (json.message.text) {
			if (json.message.text == '/start') {
				executionCtx.waitUntil(sendMessage(savedBot, json.message.chat.id, "Hello there!"));
			} else if (json.message.text.startsWith('/register ')) {
				await handleRegister(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/learn_sticker' && json.message.chat.id == savedBot.owner) {
				await handleLearnSticker(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/forget_sticker' && json.message.chat.id == savedBot.owner) {
				await handleForgetSticker(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/skip' && json.message.chat.id == savedBot.owner) {
				await handleSkipSticker(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/learn_pack' && json.message.chat.id == savedBot.owner) {
				await handleLearnPack(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/relearn_pack' && json.message.chat.id == savedBot.owner) {
				await handleRelearnPack(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/forget_pack' && json.message.chat.id == savedBot.owner) {
				await handleForgetPack(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.text == '/cancel' && json.message.chat.id == savedBot.owner) {
				await handleCancel(savedBot, env, executionCtx, id, json.message);
			} else if (!json.message.text.startsWith('/') && json.message.chat.id == savedBot.owner) {
				await handleAuthenticatedMessage(savedBot, env, executionCtx, id, json.message);
			} else if (json.message.chat.id != savedBot.owner) {
				await handleUnauthenticatedMessage(savedBot, env, executionCtx, id, json.message);
			} else {
				executionCtx.waitUntil(sendMessage(savedBot, json.message.chat.id, 'I am confused.'));
			}
		} else if (json.message.sticker && json.message.chat.id == savedBot.owner) {
			await handleStickerMessage(savedBot, env, executionCtx, id, json.message);
		}
	} else if (json.inline_query) {
		await handleInlineQuery(savedBot, env, executionCtx, id, json.inline_query);
	}
}

app.post('/webhook/:id', async c => {
	let json = await c.req.json<TelegramUpdate>();
	let webhookKey = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	let id = c.req.param("id");
	let savedBot = await c.env.STICKERS.get<SavedBot>(`bots/${id}`, 'json');
	if (!savedBot) {
		console.log("Not found")
		return c.text('not found', 404);
	}
	if (webhookKey != savedBot.webhookKey) {
		console.log("Not accepted")
		return c.text('Not accepted', 401);
	}
	console.log('Inbound', JSON.stringify(json))
	c.executionCtx.waitUntil(handleWebhookAsync(savedBot, json, c.env, c.executionCtx, id));

	return c.json({
		status_code: 200,
		body: 'ok'
	}, 200);
});

export default app