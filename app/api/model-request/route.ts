import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/app/(auth)/auth';
import { db } from '@/lib/db';
import { modelRequest } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

const modelRequestSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().endsWith('illinois.edu'),
  department: z.string().min(2),
  modelType: z.enum(['custom', 'finetuned', 'existing']),
  purpose: z.string().min(50),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  resourceRequirements: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    if (!session.user.id) {
      return new NextResponse('User ID is required', { status: 400 });
    }

    const json = await req.json();
    const body = modelRequestSchema.parse(json);

    const result = await db.insert(modelRequest).values({
      name: body.name,
      email: body.email,
      department: body.department,
      modelType: body.modelType,
      purpose: body.purpose,
      startDate: sql`${body.startDate}::date`,
      endDate: sql`${body.endDate}::date`,
      resourceRequirements: body.resourceRequirements || null,
      status: 'pending',
      userId: session.user.id,
      createdAt: sql`now()`,
      updatedAt: sql`now()`,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
} 