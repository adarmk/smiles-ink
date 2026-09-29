/** Cloudflare Worker entry point. smiles.ink renders molecules in the browser,
 * so the worker only serves the app. */
import handler from "vinext/server/app-router-entry";

export default handler;
