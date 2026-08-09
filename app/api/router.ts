import { createRouter, publicQuery } from "./middleware";
import { monitorRouter } from "./monitorRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  monitor: monitorRouter,
});

export type AppRouter = typeof appRouter;
