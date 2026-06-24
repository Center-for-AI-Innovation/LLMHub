import { NextResponse } from 'next/server';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';

import { auth } from '@/app/(auth)/auth';

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: 'File size should be less than 5MB',
    })
    // Update the file type based on the kind of files you want to accept
    .refine((file) => ['image/jpeg', 'image/png'].includes(file.type), {
      message: 'File type should be JPEG or PNG',
    }),
});

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

  return new S3Client({
    region: getEnv('S3_REGION'),
    endpoint,
    forcePathStyle: endpoint ? forcePathStyle : undefined,
    credentials: {
      accessKeyId: getEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: getEnv('S3_SECRET_ACCESS_KEY'),
    },
  });
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (request.body === null) {
    return new Response('Request body is empty', { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as Blob;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.issues
        .map((error) => error.message)
        .join(', ');

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    try {
      const filename = (formData.get('file') as File).name;
      const contentType = file.type || 'application/octet-stream';
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const bucket = getEnv('S3_BUCKET');
      const safeName = sanitizeFilename(filename || 'upload');
      const key = `uploads/${session.user?.id ?? 'unknown'}/${crypto.randomUUID()}-${safeName}`;

      const s3 = createS3Client();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fileBuffer,
          ContentType: contentType,
        }),
      );

      const ttlSeconds = Number(process.env.S3_SIGNED_URL_TTL_SECONDS ?? '900');
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
        { expiresIn: Number.isFinite(ttlSeconds) ? ttlSeconds : 900 },
      );

      return NextResponse.json({
        url,
        pathname: key,
        contentType,
      });
    } catch (error) {
      console.error('[Upload] Failed to upload file', error);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 },
    );
  }
}
