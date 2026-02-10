import { NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { getChatWithMessages } from '@/lib/db/queries';

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
    
    const chatData = await getChatWithMessages({ id });
    
    if (!chatData.chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }
    
    // For private chats, check if user is authorized
    if (chatData.chat.visibility === 'private') {
      if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      
      if (session.user.id !== chatData.chat.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    return NextResponse.json(chatData);
  } catch (error) {
    console.error('Error fetching chat contents:', error);
    return NextResponse.json({ error: 'Failed to fetch chat contents' }, { status: 500 });
  }
} 
