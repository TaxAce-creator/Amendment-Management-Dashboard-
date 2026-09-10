import "dotenv/config";
import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server/_core/app";

// Vercel serverless entry point. Vercel's Node.js runtime invokes this
// handler for every request routed here by vercel.json (everything under
// /api, /auth, and /health — see vercel.json for the exact rewrites). The
// built client in dist/public is served directly by Vercel's static CDN,
// not through this function.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await createApp();
  app(req, res);
}
