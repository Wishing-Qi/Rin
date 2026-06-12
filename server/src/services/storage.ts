import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/d1";
import Elysia, { t } from "elysia";
import path from "node:path";
import type { Env } from "../db/db";
import { setup } from "../setup";
import * as schema from "../db/schema";
import { getEnv } from "../utils/di";
import { createS3Client } from "../utils/s3";
import { ServerConfig } from "../utils/cache";

function buf2hex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

export function StorageService() {
    const env: Env = getEnv();
    const endpoint = env.S3_ENDPOINT;
    const bucket = env.S3_BUCKET;
    const folder = env.S3_FOLDER || '';
    const accessHost = env.S3_ACCESS_HOST || endpoint;
    const accessKeyId = env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
    const s3 = createS3Client();
    return new Elysia({ aot: false })
        .use(setup())
        .group('/storage', (group) =>
            group
                .post('/', async ({ uid, set, body: { key, file } }) => {

                    if (!endpoint) {
                        set.status = 500;
                        return 'S3_ENDPOINT is not defined'
                    }
                    if (!accessKeyId) {
                        set.status = 500;
                        return 'S3_ACCESS_KEY_ID is not defined'
                    }
                    if (!secretAccessKey) {
                        set.status = 500;
                        return 'S3_SECRET_ACCESS_KEY is not defined'
                    }
                    if (!bucket) {
                        set.status = 500;
                        return 'S3_BUCKET is not defined'
                    }
                    if (!uid) {
                        set.status = 401;
                        return 'Unauthorized';
                    }
                    const suffix = key.includes(".") ? key.split('.').pop() : "";
                    const hashArray = await crypto.subtle.digest(
                        { name: 'SHA-1' },
                        await file.arrayBuffer()
                    );
                    const hash = buf2hex(hashArray)
                    const hashkey = path.join(folder, hash + "." + suffix);
                    try {
                        const response = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: hashkey, Body: file, ContentType: file.type }))
                        console.info(response);
                        return `${accessHost}/${hashkey}`
                    } catch (e: any) {
                        set.status = 400;
                        console.error(e.message)
                        return e.message
                    }
                }, {
                    body: t.Object({
                        key: t.String(),
                        file: t.File()
                    })
                })
                .get('/cleanup', async ({ uid, set, query }) => {
                    const db = drizzle(env.DB, { schema });
                    const user = await db.query.users.findFirst({
                        where: (users, { eq }) => eq(users.id, uid || 0)
                    });

                    if (!user || user.permission !== 1) {
                        set.status = 403;
                        return 'Forbidden';
                    }

                    // 读取例外配置
                    const excludeExceptions = query.excludeExceptions !== 'false';

                    try {
                        const listResponse = await s3.send(new ListObjectsV2Command({
                            Bucket: bucket,
                            Prefix: folder
                        }));
                        const s3Keys = (listResponse.Contents || []).map(item => item.Key).filter(Boolean) as string[];

                        if (s3Keys.length === 0) return [];

                        const [allFeeds, allMoments, allUsers, allFriends] = await Promise.all([
                            db.query.feeds.findMany({ columns: { content: true } }),
                            db.query.moments.findMany({ columns: { content: true } }),
                            db.query.users.findMany({ columns: { avatar: true } }),
                            db.query.friends.findMany({ columns: { avatar: true } })
                        ]);

                        const dbTexts = [
                            ...allFeeds.map(f => f.content),
                            ...allMoments.map(m => m.content),
                            ...allUsers.map(u => u.avatar),
                            ...allFriends.map(f => f.avatar)
                        ].join(" ");

                        const accessHostClean = accessHost.replace(/^https?:\/\//, '');

                        const unusedKeys = s3Keys.filter(key => {
                            const isUsed = dbTexts.includes(key) || (accessHostClean && dbTexts.includes(`${accessHostClean}/${key}`));
                            return !isUsed;
                        });

                        // 读取例外文件列表
                        const serverConfig = ServerConfig();
                        const exceptionsStr = await serverConfig.get<string>('storage.cleanup.exceptions');
                        const exceptions: string[] = exceptionsStr ? exceptionsStr.split('\n').filter(s => s.trim()) : [];

                        // 标记例外文件
                        const results = unusedKeys.map(key => {
                            const isException = exceptions.some(exc => key.includes(exc.trim()));
                            return {
                                key,
                                url: `${accessHost}/${key}`,
                                isException
                            };
                        });

                        // 如果开启了排除例外，过滤掉例外文件
                        if (excludeExceptions) {
                            return results.filter(r => !r.isException);
                        }
                        return results;
                    } catch (e: any) {
                        set.status = 500;
                        return e.message;
                    }
                })
                .post('/cleanup', async ({ uid, set, body: { keys } }) => {
                    const db = drizzle(env.DB, { schema });
                    const user = await db.query.users.findFirst({
                        where: (users, { eq }) => eq(users.id, uid || 0)
                    });

                    if (!user || user.permission !== 1) {
                        set.status = 403;
                        return 'Forbidden';
                    }

                    if (!keys || !Array.isArray(keys) || keys.length === 0) {
                        return { deleted: 0, message: "No keys provided" };
                    }

                    try {
                        await s3.send(new DeleteObjectsCommand({
                            Bucket: bucket,
                            Delete: {
                                Objects: keys.map(key => ({ Key: key }))
                            }
                        }));

                        return {
                            deleted: keys.length,
                            message: `Successfully cleaned up ${keys.length} files`
                        };
                    } catch (e: any) {
                        set.status = 500;
                        return e.message;
                    }
                }, {
                    body: t.Object({
                        keys: t.Array(t.String())
                    })
                })
        );
}