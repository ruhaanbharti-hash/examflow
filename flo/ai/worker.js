// Flo · runs the on-device AI model in a background thread so the page stays smooth.
import { WebWorkerMLCEngineHandler } from "../vendor/web-llm.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
