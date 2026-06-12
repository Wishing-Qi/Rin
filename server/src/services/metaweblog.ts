import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import Elysia from "elysia";
import * as schema from "../db/schema";
import { feeds, hashtags, users, feedHashtags } from "../db/schema";
import { jsonToXmlrpcFault, jsonToXmlrpcResponse, xmlrpcToJSON } from "../utils/xmlrpc";
import { getEnv } from "../utils/di";
import { createS3Client } from "../utils/s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";

export function MetaWeblogService() {
    const env = getEnv();

    async function validateUser(db: any, username: string, apiKey: string) {
        const user = await db.query.users.findFirst({
            where: eq(users.username, username)
        });
        if (!user || user.apiKey !== apiKey || user.permission !== 1) {
            return null;
        }
        return user;
    }

    return new Elysia({ aot: false })
        .post('/api/xmlrpc', async ({ body, set }) => {
            set.headers['Content-Type'] = 'text/xml';

            try {
                const xml = typeof body === 'string' ? body : JSON.stringify(body);
                const { methodName, params } = xmlrpcToJSON(xml);
                const db = drizzle(env.DB, { schema });

                // 1. blogger.getUsersBlogs(appkey, username, password)
                if (methodName === 'blogger.getUsersBlogs') {
                    const [_appkey, username, apiKey] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    return jsonToXmlrpcResponse([
                        {
                            blogid: "1",
                            blogName: user.username,
                            url: env.FRONTEND_URL,
                            isAdmin: true
                        }
                    ]);
                }

                // 2. metaWeblog.getRecentPosts(blogid, username, password, numberOfPosts)
                if (methodName === 'metaWeblog.getRecentPosts') {
                    const [_blogid, username, apiKey, numberOfPosts] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    const posts = await db.query.feeds.findMany({
                        where: eq(feeds.uid, user.id),
                        orderBy: [desc(feeds.createdAt)],
                        limit: numberOfPosts || 10,
                        with: {
                            hashtags: {
                                with: { hashtag: true }
                            }
                        }
                    });

                    return jsonToXmlrpcResponse(posts.map((p: any) => ({
                        postid: p.id.toString(),
                        title: p.title || "",
                        description: p.content,
                        link: `${env.FRONTEND_URL}/feed/${p.id}`,
                        dateCreated: p.createdAt,
                        categories: p.hashtags.map((h: any) => h.hashtag.name),
                        publish: p.draft === 0
                    })));
                }

                // 3. metaWeblog.getPost(postid, username, password)
                if (methodName === 'metaWeblog.getPost') {
                    const [postId, username, apiKey] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    const post = await db.query.feeds.findFirst({
                        where: and(eq(feeds.id, parseInt(postId)), eq(feeds.uid, user.id)),
                        with: {
                            hashtags: {
                                with: { hashtag: true }
                            }
                        }
                    });

                    if (!post) return jsonToXmlrpcFault(404, "Post not found");

                    return jsonToXmlrpcResponse({
                        postid: post.id.toString(),
                        title: post.title || "",
                        description: post.content,
                        link: `${env.FRONTEND_URL}/feed/${post.id}`,
                        dateCreated: post.createdAt,
                        categories: post.hashtags.map((h: any) => h.hashtag.name),
                        publish: post.draft === 0
                    });
                }

                // 4. metaWeblog.newPost(blogid, username, password, post, publish)
                if (methodName === 'metaWeblog.newPost') {
                    const [_blogid, username, apiKey, postData, publish] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    const result = await db.insert(feeds).values({
                        title: postData.title,
                        content: postData.description,
                        uid: user.id,
                        draft: publish ? 0 : 1,
                        listed: 1,
                        summary: postData.description.substring(0, 200)
                    }).returning({ insertedId: feeds.id });

                    const newPostId = result[0].insertedId;

                    // Handle categories (tags)
                    if (postData.categories && Array.isArray(postData.categories)) {
                        for (const catName of postData.categories) {
                            let tagId: number;
                            const existingTag = await db.query.hashtags.findFirst({ where: eq(hashtags.name, catName) });
                            if (!existingTag) {
                                const tagResult = await db.insert(hashtags).values({ name: catName }).returning({ id: hashtags.id });
                                tagId = tagResult[0].id;
                            } else {
                                tagId = existingTag.id;
                            }
                            await db.insert(feedHashtags).values({ feedId: newPostId, hashtagId: tagId });
                        }
                    }

                    return jsonToXmlrpcResponse(newPostId.toString());
                }

                // 5. metaWeblog.editPost(postid, username, password, post, publish)
                if (methodName === 'metaWeblog.editPost') {
                    const [postId, username, apiKey, postData, publish] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    await db.update(feeds).set({
                        title: postData.title,
                        content: postData.description,
                        draft: publish ? 0 : 1,
                        updatedAt: new Date(),
                        summary: postData.description.substring(0, 200)
                    }).where(and(eq(feeds.id, parseInt(postId)), eq(feeds.uid, user.id)));

                    // Update categories (simple approach: clear and re-add)
                    await db.delete(feedHashtags).where(eq(feedHashtags.feedId, parseInt(postId)));
                    if (postData.categories && Array.isArray(postData.categories)) {
                        for (const catName of postData.categories) {
                            let tagId: number;
                            const existingTag = await db.query.hashtags.findFirst({ where: eq(hashtags.name, catName) });
                            if (!existingTag) {
                                const tagResult = await db.insert(hashtags).values({ name: catName }).returning({ id: hashtags.id });
                                tagId = tagResult[0].id;
                            } else {
                                tagId = existingTag.id;
                            }
                            await db.insert(feedHashtags).values({ feedId: parseInt(postId), hashtagId: tagId });
                        }
                    }

                    return jsonToXmlrpcResponse(true);
                }

                // 6. blogger.deletePost(appkey, postid, username, password, publish)
                // Note: MetaWeblog sometimes uses blogger.deletePost or metaWeblog.deletePost
                if (methodName === 'blogger.deletePost' || methodName === 'metaWeblog.deletePost') {
                    const [_appkey, postId, username, apiKey] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    await db.delete(feeds).where(and(eq(feeds.id, parseInt(postId)), eq(feeds.uid, user.id)));
                    return jsonToXmlrpcResponse(true);
                }

                // 7. metaWeblog.newMediaObject(blogid, username, password, mediaObject)
                if (methodName === 'metaWeblog.newMediaObject') {
                    const [_blogid, username, apiKey, mediaObject] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    const { name, bits, type } = mediaObject;
                    if (!bits) return jsonToXmlrpcFault(400, "Missing file bits");

                    const s3 = createS3Client();
                    const bucket = env.S3_BUCKET;
                    const folder = env.S3_FOLDER || '';
                    const accessHost = env.S3_ACCESS_HOST || env.S3_ENDPOINT;
                    
                    // Decode base64
                    const buffer = Buffer.from(bits, 'base64');
                    const suffix = path.extname(name);
                    
                    const hashArray = await crypto.subtle.digest({ name: 'SHA-1' }, buffer);
                    const hash = Array.from(new Uint8Array(hashArray)).map(b => b.toString(16).padStart(2, '0')).join('');
                    const key = path.join(folder, `${hash}${suffix}`).replace(/\\/g, '/');

                    await s3.send(new PutObjectCommand({ 
                        Bucket: bucket, 
                        Key: key, 
                        Body: buffer, 
                        ContentType: type 
                    }));

                    return jsonToXmlrpcResponse({
                        url: `${accessHost.startsWith('http') ? '' : 'https://'}${accessHost}/${key}`
                    });
                }

                // 8. wp.getCategories(blogid, username, password)
                if (methodName === 'wp.getCategories' || methodName === 'metaWeblog.getCategories') {
                    const [_blogid, username, apiKey] = params;
                    const user = await validateUser(db, username, apiKey);
                    if (!user) return jsonToXmlrpcFault(403, "Invalid username or API Key");

                    const tags = await db.query.hashtags.findMany();
                    return jsonToXmlrpcResponse(tags.map(t => ({
                        description: t.name,
                        categoryName: t.name,
                        htmlUrl: `${env.FRONTEND_URL}/hashtag/${t.id}`,
                        rssUrl: ""
                    })));
                }

                return jsonToXmlrpcFault(404, `Method ${methodName} not implemented`);

            } catch (e: any) {
                console.error(e);
                return jsonToXmlrpcFault(500, e.message || "Internal Server Error");
            }
        });
}
