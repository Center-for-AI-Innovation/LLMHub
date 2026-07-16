import { type NextResponse as NextResponseType } from 'next/server';
import { NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8000';

export interface LaunchDefaults {
  partition: string;
  resource_type: string;
  time: string;
}

export async function GET(): Promise<NextResponseType> {
  const res = await fetch(`${BACKEND_API_URL}/api/models/launch-defaults`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return NextResponse.json(
      {
        error:
          errorText ||
          `Failed to fetch launch defaults: ${res.status} ${res.statusText}`,
      },
      { status: res.status },
    );
  }

  const data: LaunchDefaults = await res.json();
  return NextResponse.json(data);
}
