import { Environment } from "hono/dist/hono"
export interface EnvBindings {
	STICKERS: KVNamespace
}
export interface Env extends Environment {
	Bindings: EnvBindings
}
