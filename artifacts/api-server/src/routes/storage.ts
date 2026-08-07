import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { Readable } from "stream";
import { getAuth } from "../lib/auth-compat";
import { db, portalUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

async function requireAuthUser(req: any, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = getAuth(req);
    const clerkId = (auth?.sessionClaims as any)?.userId || auth?.userId;
    if (!clerkId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [user] = await db
      .select()
      .from(portalUsersTable)
      .where(eq(portalUsersTable.clerkId, clerkId as string));
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.portalUser = user;
    next();
  } catch (err) {
    req.log?.error({ err }, "storage auth failed");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuthUser, async (req: any, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL({
      userId: req.portalUser.id,
    });
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
    return;
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
    return;
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
      return;
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
    return;
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Two access modes based on path prefix:
 *  - research-media/* — public ad screenshots/videos for the Ad Research Board
 *    add-on. Served without auth so they can be embedded in <img>/<video> tags
 *    that don't carry the Clerk session cookie.
 *  - everything else (including user uploads under uploads/<userId>/...) — must
 *    be authenticated. We re-use Clerk session + portal_users lookup, then
 *    optionally fall back to the ACL stored on the object's GCS metadata.
 */
router.get("/storage/objects/*path", async (req: any, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const isPublicResearchMedia = wildcardPath.startsWith("research-media/");

    if (!isPublicResearchMedia) {
      // Require an authenticated portal user for any other private object.
      const auth = getAuth(req);
      const clerkId = (auth?.sessionClaims as any)?.userId || auth?.userId;
      if (!clerkId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const [user] = await db
        .select()
        .from(portalUsersTable)
        .where(eq(portalUsersTable.clerkId, clerkId as string));
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      // Best-effort ACL check (admins always pass). If no ACL is set, fall back
      // to "user must own the upload prefix uploads/<userId>/...".
      const objectFileForAcl = await objectStorageService.getObjectEntityFile(objectPath);
      let canAccess = false;
      try {
        canAccess = await objectStorageService.canAccessObjectEntity({
          userId: String(user.id),
          objectFile: objectFileForAcl,
          requestedPermission: ObjectPermission.READ,
        });
      } catch {
        canAccess = false;
      }
      const ownsByPrefix =
        wildcardPath.startsWith(`uploads/${user.id}/`) || user.role === "admin";
      if (!canAccess && !ownsByPrefix) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
      return;
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
    return;
  }
});

export default router;
