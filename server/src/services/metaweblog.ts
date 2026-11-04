import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, DB } from "../core/hono-types";
import { feedHashtags, feeds, hashtags, users } from "../db/schema";
import { putStorageObject } from "../utils/storage";
import { jsonToXmlrpcFault, jsonToXmlrpcResponse, xmlrpcToJSON } from "../utils/xmlrpc";
import { clearFeedCache, clearFeedCollectionCaches } from "./clear-feed-cache";
import { getUserApiKey } from "./custom-admin";

function buf2hex(buffer: ArrayBuffer) {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function getExtname(filename: string) {
    const idx = filename.lastIndexOf(".");
    return idx >= 0 ? filename.slice(idx) : "";
}

export function MetaWeblogService(): Hono {
    const app = new Hono();

    async function validateUser(db: DB, username: string, apiKey: string) {
        const user = await db.query.users.findFirst({
            where: eq(users.username, username),
        });
        if (!user || user.permission !== 1 || !apiKey) {
            return null;
        }
        const storedKey = await getUserApiKey(db, user.id);
        if (!storedKey || storedKey !== apiKey) {
            return null;
        }
        return user;
    }

    app.get("/", (c) => c.text("Hello"));

    app.post("/", async (c: AppContext) => {
        const db = c.get("db");
        const env = c.get("env");
        const cache = c.get("cache");
        const origin = new URL(c.req.url).origin;
        const frontendUrl = env.FRONTEND_URL || origin;

        const xmlReply = (body: string) =>
            new Response(body, {
                status: 200,
                headers: { "Content-Type": "text/xml; charset=utf-8" },
            });

        try {
            let xml: string;
            try {
                xml = await c.req.text();
            } catch (bodyErr: any) {
                return xmlReply(jsonToXmlrpcFault(500, `Body parse error: ${bodyErr.message}`));
            }

            if (!xml || xml.trim() === "") {
                return xmlReply(jsonToXmlrpcFault(400, "Empty request body"));
            }

            let methodName: string;
            let params: any[];
            try {
                const parsed = xmlrpcToJSON(xml);
                methodName = parsed.methodName;
                params = parsed.params;
            } catch (parseErr: any) {
                return xmlReply(jsonToXmlrpcFault(400, `XML parse error: ${parseErr.message}`));
            }

            // 1. blogger.getUsersBlogs(appkey, username, password)
            if (methodName === "blogger.getUsersBlogs") {
                const [_appkey, username, apiKey] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                return xmlReply(
                    jsonToXmlrpcResponse([
                        {
                            blogid: "1",
                            blogName: user.username,
                            url: frontendUrl,
                            isAdmin: true,
                        },
                    ]),
                );
            }

            // 2. metaWeblog.getRecentPosts(blogid, username, password, numberOfPosts)
            if (methodName === "metaWeblog.getRecentPosts") {
                const [_blogid, username, apiKey, numberOfPosts] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const posts = await db.query.feeds.findMany({
                    where: eq(feeds.uid, user.id),
                    orderBy: [desc(feeds.createdAt)],
                    limit: numberOfPosts || 10,
                    with: {
                        hashtags: {
                            with: { hashtag: true },
                        },
                    },
                });

                return xmlReply(
                    jsonToXmlrpcResponse(
                        posts.map((p: any) => ({
                            postid: p.id.toString(),
                            title: p.title || "",
                            description: p.content,
                            link: `${frontendUrl}/feed/${p.id}`,
                            dateCreated: p.createdAt,
                            categories: p.hashtags.map((h: any) => h.hashtag.name),
                            publish: p.draft === 0,
                        })),
                    ),
                );
            }

            // 3. metaWeblog.getPost(postid, username, password)
            if (methodName === "metaWeblog.getPost") {
                const [postId, username, apiKey] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const post = await db.query.feeds.findFirst({
                    where: and(eq(feeds.id, parseInt(postId)), eq(feeds.uid, user.id)),
                    with: {
                        hashtags: {
                            with: { hashtag: true },
                        },
                    },
                });

                if (!post) return xmlReply(jsonToXmlrpcFault(404, "Post not found"));

                return xmlReply(
                    jsonToXmlrpcResponse({
                        postid: post.id.toString(),
                        title: post.title || "",
                        description: post.content,
                        link: `${frontendUrl}/feed/${post.id}`,
                        dateCreated: post.createdAt,
                        categories: post.hashtags.map((h: any) => h.hashtag.name),
                        publish: post.draft === 0,
                    }),
                );
            }

            // 4. metaWeblog.newPost(blogid, username, password, post, publish)
            if (methodName === "metaWeblog.newPost") {
                const [_blogid, username, apiKey, postData, publish] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const result = await db
                    .insert(feeds)
                    .values({
                        title: postData.title,
                        content: postData.description,
                        uid: user.id,
                        draft: publish ? 0 : 1,
                        listed: 1,
                        summary: postData.description.substring(0, 200),
                    })
                    .returning({ insertedId: feeds.id });

                if (!result || !result[0]) {
                    return xmlReply(jsonToXmlrpcFault(500, "Failed to create post"));
                }

                const newPostId = result[0].insertedId;

                if (postData.categories && Array.isArray(postData.categories)) {
                    for (const catName of postData.categories) {
                        let tagId: number;
                        const existingTag = await db.query.hashtags.findFirst({
                            where: eq(hashtags.name, catName),
                        });
                        if (!existingTag) {
                            const tagResult = await db
                                .insert(hashtags)
                                .values({ name: catName })
                                .returning({ id: hashtags.id });
                            tagId = tagResult[0].id;
                        } else {
                            tagId = existingTag.id;
                        }
                        await db.insert(feedHashtags).values({ feedId: newPostId, hashtagId: tagId });
                    }
                }

                await clearFeedCollectionCaches(cache);
                return xmlReply(jsonToXmlrpcResponse(newPostId.toString()));
            }

            // 5. metaWeblog.editPost(postid, username, password, post, publish)
            if (methodName === "metaWeblog.editPost") {
                const [postId, username, apiKey, postData, publish] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const feedId = parseInt(postId);
                const existingFeed = await db.query.feeds.findFirst({
                    where: and(eq(feeds.id, feedId), eq(feeds.uid, user.id)),
                    columns: { alias: true },
                });

                await db
                    .update(feeds)
                    .set({
                        title: postData.title,
                        content: postData.description,
                        draft: publish ? 0 : 1,
                        updatedAt: new Date(),
                        summary: postData.description.substring(0, 200),
                    })
                    .where(and(eq(feeds.id, feedId), eq(feeds.uid, user.id)));

                await db.delete(feedHashtags).where(eq(feedHashtags.feedId, feedId));
                if (postData.categories && Array.isArray(postData.categories)) {
                    for (const catName of postData.categories) {
                        let tagId: number;
                        const existingTag = await db.query.hashtags.findFirst({
                            where: eq(hashtags.name, catName),
                        });
                        if (!existingTag) {
                            const tagResult = await db
                                .insert(hashtags)
                                .values({ name: catName })
                                .returning({ id: hashtags.id });
                            tagId = tagResult[0].id;
                        } else {
                            tagId = existingTag.id;
                        }
                        await db.insert(feedHashtags).values({ feedId, hashtagId: tagId });
                    }
                }

                await clearFeedCache(cache, feedId, existingFeed?.alias ?? null, existingFeed?.alias ?? null);
                return xmlReply(jsonToXmlrpcResponse(true));
            }

            // 6. blogger.deletePost / metaWeblog.deletePost
            if (methodName === "blogger.deletePost" || methodName === "metaWeblog.deletePost") {
                const [_appkey, postId, username, apiKey] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const feedId = parseInt(postId);
                const existingFeed = await db.query.feeds.findFirst({
                    where: and(eq(feeds.id, feedId), eq(feeds.uid, user.id)),
                    columns: { alias: true },
                });

                await db.delete(feeds).where(and(eq(feeds.id, feedId), eq(feeds.uid, user.id)));
                await clearFeedCache(cache, feedId, existingFeed?.alias ?? null, null);

                return xmlReply(jsonToXmlrpcResponse(true));
            }

            // 7. metaWeblog.newMediaObject(blogid, username, password, mediaObject)
            if (methodName === "metaWeblog.newMediaObject") {
                const [_blogid, username, apiKey, mediaObject] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const { name, bits, type } = mediaObject;
                if (!bits) return xmlReply(jsonToXmlrpcFault(400, "Missing file bits"));

                const binaryString = atob(bits);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }

                const suffix = getExtname(name || "");
                const hashArray = await crypto.subtle.digest({ name: "SHA-1" }, bytes.buffer);
                const hash = buf2hex(hashArray);
                const key = `${hash}${suffix}`;

                const uploaded = await putStorageObject(env, key, bytes, type, origin);
                return xmlReply(
                    jsonToXmlrpcResponse({
                        url: uploaded.url,
                    }),
                );
            }

            // 8. wp.getCategories / metaWeblog.getCategories
            if (methodName === "wp.getCategories" || methodName === "metaWeblog.getCategories") {
                const [_blogid, username, apiKey] = params;
                const user = await validateUser(db, username, apiKey);
                if (!user) return xmlReply(jsonToXmlrpcFault(403, "Invalid username or API Key"));

                const tags = await db.query.hashtags.findMany();
                return xmlReply(
                    jsonToXmlrpcResponse(
                        tags.map((t) => ({
                            description: t.name,
                            categoryName: t.name,
                            htmlUrl: `${frontendUrl}/hashtag/${t.id}`,
                            rssUrl: "",
                        })),
                    ),
                );
            }

            return xmlReply(jsonToXmlrpcFault(404, `Method ${methodName} not implemented`));
        } catch (e: any) {
            console.error("[MetaWeblog Error]", e);
            return xmlReply(jsonToXmlrpcFault(500, `Error: ${e.message}`));
        }
    });

    return app;
}
