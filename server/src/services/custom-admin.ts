import { eq } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { Hono } from "hono";
import type { AppContext, DB } from "../core/hono-types";
import { info } from "../db/schema";
import { buildS3ObjectUrl, createS3Client } from "../utils/s3";
import { getStoragePublicUrl, resolveStorageTarget } from "../utils/storage";

const API_KEY_PREFIX = "api_key:";

export async function getUserApiKey(db: DB, userId: number): Promise<string | null> {
    const keyName = `${API_KEY_PREFIX}${userId}`;
    const row = await db.query.info.findFirst({
        where: eq(info.key, keyName),
    });

    return row?.value || null;
}

export async function setUserApiKey(db: DB, userId: number, apiKey: string): Promise<void> {
    const keyName = `${API_KEY_PREFIX}${userId}`;
    await db
        .insert(info)
        .values({ key: keyName, value: apiKey })
        .onConflictDoUpdate({
            target: info.key,
            set: { value: apiKey },
        });
}

async function listStorageKeys(env: Env): Promise<string[]> {
    const target = resolveStorageTarget(env);

    if (target.type === "r2") {
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
            const listed = await target.bucket.list({
                prefix: target.folder || undefined,
                cursor,
            });
            for (const obj of listed.objects) {
                if (obj.key) {
                    keys.push(obj.key);
                }
            }
            cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
        return keys;
    }

    const client = createS3Client(env);
    const baseUrl = buildS3ObjectUrl(env, "");
    const listUrl = new URL(baseUrl);
    listUrl.searchParams.set("list-type", "2");
    if (target.folder) {
        listUrl.searchParams.set("prefix", target.folder);
    }

    const response = await client.fetch(listUrl.toString(), { method: "GET" });
    if (!response.ok) {
        throw new Error(`Failed to list S3 objects: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const parser = new XMLParser();
    const parsed = parser.parse(xml);
    const contents = parsed?.ListBucketResult?.Contents;
    if (!contents) {
        return [];
    }

    const items = Array.isArray(contents) ? contents : [contents];
    return items.map((item: any) => String(item?.Key || "")).filter(Boolean);
}

async function deleteStorageKeys(env: Env, keys: string[]): Promise<void> {
    const target = resolveStorageTarget(env);

    if (target.type === "r2") {
        await target.bucket.delete(keys);
        return;
    }

    const client = createS3Client(env);
    await Promise.all(
        keys.map(async (key) => {
            const objectUrl = buildS3ObjectUrl(env, key);
            const response = await client.fetch(objectUrl, { method: "DELETE" });
            if (!response.ok && response.status !== 404) {
                throw new Error(`Failed to delete S3 key "${key}": ${response.status} ${response.statusText}`);
            }
        }),
    );
}

export function CustomAdminService(): Hono {
    const app = new Hono();

    app.get("/user/api-key", async (c: AppContext) => {
        const uid = c.get("uid");
        const admin = c.get("admin");
        const db = c.get("db");

        if (!uid || !admin) {
            return c.text("Permission denied", 403);
        }

        const apiKey = await getUserApiKey(db, uid);
        return c.json({ apiKey: apiKey || "" });
    });

    app.post("/user/api-key", async (c: AppContext) => {
        const uid = c.get("uid");
        const admin = c.get("admin");
        const db = c.get("db");

        if (!uid || !admin) {
            return c.text("Permission denied", 403);
        }

        const apiKey = crypto.randomUUID();
        await setUserApiKey(db, uid, apiKey);
        return c.json({ apiKey });
    });

    app.get("/storage/cleanup", async (c: AppContext) => {
        const uid = c.get("uid");
        const admin = c.get("admin");
        const db = c.get("db");
        const env = c.get("env");
        const serverConfig = c.get("serverConfig");

        if (!uid || !admin) {
            return c.text("Forbidden", 403);
        }

        const excludeExceptions = c.req.query("excludeExceptions") !== "false";
        const baseUrl = new URL(c.req.url).origin;

        try {
            const s3Keys = await listStorageKeys(env);
            if (s3Keys.length === 0) {
                return c.json([]);
            }

            const [allFeeds, allMoments, allUsers, allFriends] = await Promise.all([
                db.query.feeds.findMany({ columns: { content: true } }),
                db.query.moments.findMany({ columns: { content: true } }),
                db.query.users.findMany({ columns: { avatar: true } }),
                db.query.friends.findMany({ columns: { avatar: true } }),
            ]);

            const dbTexts = [
                ...allFeeds.map((f) => f.content),
                ...allMoments.map((m) => m.content),
                ...allUsers.map((u) => u.avatar),
                ...allFriends.map((f) => f.avatar),
            ].join(" ");

            const accessHost = env.S3_ACCESS_HOST || env.S3_ENDPOINT || "";
            const accessHostClean = accessHost.replace(/^https?:\/\//, "");

            const unusedKeys = s3Keys.filter((key) => {
                const isUsed =
                    dbTexts.includes(key) ||
                    (accessHostClean && dbTexts.includes(`${accessHostClean}/${key}`));
                return !isUsed;
            });

            const exceptionsStr = await serverConfig.get("storage.cleanup.exceptions");
            const exceptions: string[] = exceptionsStr
                ? String(exceptionsStr)
                      .split("\n")
                      .filter((s: string) => s.trim())
                : [];

            const results = unusedKeys.map((key) => {
                const isException = exceptions.some((exc) => key.includes(exc.trim()));
                return {
                    key,
                    url: getStoragePublicUrl(env, key, baseUrl),
                    isException,
                };
            });

            if (excludeExceptions) {
                return c.json(results.filter((r) => !r.isException));
            }

            return c.json(results);
        } catch (e: any) {
            return c.text(e.message || "Cleanup scan failed", 500);
        }
    });

    app.post("/storage/cleanup", async (c: AppContext) => {
        const uid = c.get("uid");
        const admin = c.get("admin");
        const env = c.get("env");

        if (!uid || !admin) {
            return c.text("Forbidden", 403);
        }

        const body = await c.req.json<{ keys?: string[] }>().catch(() => ({ keys: [] }));
        const keys = body?.keys;

        if (!keys || !Array.isArray(keys) || keys.length === 0) {
            return c.json({ deleted: 0, message: "No keys provided" });
        }

        try {
            await deleteStorageKeys(env, keys);
            return c.json({
                deleted: keys.length,
                message: `Successfully cleaned up ${keys.length} files`,
            });
        } catch (e: any) {
            return c.text(e.message || "Cleanup delete failed", 500);
        }
    });

    return app;
}
