import { auth } from '@/app/(auth)/auth';
import { saveChat } from '@/lib/db/queries';

export async function POST(request: Request) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { id } = await request.json();
    
    await saveChat({
      id,
      userId: session.user.id,
      title: 'New Chat',
      isBrowserChat: true,
    });

    return Response.json({ id });
  } catch (error) {
    console.error('Failed to create chat:', error);
    return new Response('Failed to create chat', { status: 500 });
  }
} 