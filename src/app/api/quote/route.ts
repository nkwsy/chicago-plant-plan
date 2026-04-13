import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { QuoteRequest } from '@/lib/db/models';
import { nanoid } from 'nanoid';

export async function POST(request: Request) {
  try {
    await connectDB();
    const body = await request.json();

    if (!body.email || !body.planId) {
      return NextResponse.json({ error: 'email and planId required' }, { status: 400 });
    }

    const quoteId = nanoid(12);
    const quote = new QuoteRequest({
      quoteId,
      planId: body.planId,
      email: body.email,
      name: body.name || '',
      phone: body.phone || '',
      notes: body.notes || '',
      status: 'pending',
    });

    await quote.save();
    return NextResponse.json({
      quoteId,
      message: 'Quote request received! We will compile pricing from local nurseries and email you within 2-3 business days.',
    }, { status: 201 });
  } catch (error) {
    console.error('Quote request error:', error);
    return NextResponse.json({ error: 'Failed to submit quote request' }, { status: 500 });
  }
}
