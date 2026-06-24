import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getChatById } from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const parsedParams = await params;
    const { id } = parsedParams;
    
    if (!id) {
      return NextResponse.json({ error: 'Chat ID is required' }, { status: 400 });
    }
    
    const chat = await getChatById({ id });
    
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    
    // For private chats, check if user is authorized
    if (chat.visibility === 'private') {
      if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      
      if (session.user.id !== chat.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    return NextResponse.json(chat);
  } catch (error) {
    console.error('Error fetching chat:', error);
    return NextResponse.json({ error: 'Failed to fetch chat' }, { status: 500 });
  }
} 
