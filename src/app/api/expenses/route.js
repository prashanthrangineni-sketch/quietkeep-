import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { user_id, description, amount, category, date } = await request.json();

    // Validate inputs
    if (!description || !amount || !category) {
      return Response.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Insert expense
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        user_id,
        description,
        amount: parseFloat(amount),
        category,
        date: date || new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return Response.json(data, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const limit = searchParams.get('limit') || 50;

    if (!userId) {
      return Response.json(
        { error: 'user_id required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const expenseId = searchParams.get('id');

    if (!expenseId) {
      return Response.json(
        { error: 'id required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', expenseId);

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
