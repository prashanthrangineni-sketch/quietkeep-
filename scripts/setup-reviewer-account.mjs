import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const email = 'reviewer-demo@quietkeep.com';
const password = 'QuietKeepReviewer2026!';

async function setup() {
  console.log(`Setting up reviewer account: ${email}`);

  // 1. Check or create Auth user
  let userId;
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Failed to list users:', listError.message);
    process.exit(1);
  }

  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    userId = existingUser.id;
    console.log(`User exists with ID: ${userId}. Resetting password and confirming email...`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: password,
      email_confirm: true
    });
    if (updateError) {
      console.error('Failed to update user password:', updateError.message);
      process.exit(1);
    }
  } else {
    console.log('Creating new auth user...');
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { full_name: 'Demo User' }
    });
    if (createError) {
      console.error('Failed to create user:', createError.message);
      process.exit(1);
    }
    userId = newUser.user.id;
    console.log(`Created new user with ID: ${userId}`);
  }

  // 2. Setup profile
  console.log('Setting up profile...');
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      user_id: userId,
      full_name: 'Demo User',
      onboarding_done: true,
      workspace_type: 'business', // Default to business
      business_name: 'QuietKeep Reviewer Workspace',
      business_type: 'retail',
      business_onboarding_done: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (profileError) {
    console.error('Failed to upsert profile:', profileError.message);
    process.exit(1);
  }

  // 3. Setup business workspace
  console.log('Setting up business workspace...');
  let workspaceId;
  const { data: existingWS, error: findWSError } = await supabase
    .from('business_workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (findWSError) {
    console.error('Error searching for workspace:', findWSError.message);
    process.exit(1);
  }

  if (existingWS) {
    workspaceId = existingWS.id;
    console.log(`Workspace already exists with ID: ${workspaceId}. Updating...`);
    const { error: updateWSError } = await supabase
      .from('business_workspaces')
      .update({
        name: 'QuietKeep Reviewer Workspace',
        business_type: 'retail',
        updated_at: new Date().toISOString()
      })
      .eq('id', workspaceId);
    if (updateWSError) {
      console.error('Failed to update workspace:', updateWSError.message);
      process.exit(1);
    }
  } else {
    console.log('Inserting new workspace...');
    const { data: newWS, error: createWSError } = await supabase
      .from('business_workspaces')
      .insert({
        owner_user_id: userId,
        name: 'QuietKeep Reviewer Workspace',
        business_type: 'retail',
        gstin: '36AAAAA0000A1Z1',
        phone: '9876543210'
      })
      .select('id')
      .single();

    if (createWSError) {
      console.error('Failed to create workspace:', createWSError.message);
      process.exit(1);
    }
    workspaceId = newWS.id;
    console.log(`Created new workspace with ID: ${workspaceId}`);
  }

  // 4. Setup workspace owner member in business_members
  console.log('Checking owner member record...');
  const { data: ownerMember, error: ownerMemberError } = await supabase
    .from('business_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (ownerMemberError) {
    console.error('Failed to check owner member:', ownerMemberError.message);
    process.exit(1);
  }

  if (!ownerMember) {
    console.log('Inserting owner member record...');
    const { error: insertOwnerError } = await supabase
      .from('business_members')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        name: 'Demo User',
        phone: '9876543210',
        email: email,
        role: 'owner',
        access_role: 'owner',
        status: 'active',
        date_of_joining: new Date().toISOString().slice(0, 10)
      });
    if (insertOwnerError) {
      console.error('Failed to insert owner member:', insertOwnerError.message);
      process.exit(1);
    }
  }

  // Clear existing mock records to avoid duplication
  console.log('Clearing old mock records...');
  await supabase.from('reminders').delete().eq('user_id', userId);
  await supabase.from('keeps').delete().eq('user_id', userId);
  await supabase.from('expenses').delete().eq('user_id', userId);
  await supabase.from('business_customers').delete().eq('workspace_id', workspaceId);
  await supabase.from('business_invoices').delete().eq('workspace_id', workspaceId);
  await supabase.from('business_ledger').delete().eq('workspace_id', workspaceId);
  // Clear other members (excluding owner)
  await supabase.from('business_members').delete().eq('workspace_id', workspaceId).neq('user_id', userId);

  // 5. Populate Reminders (5 items)
  console.log('Populating reminders...');
  const remindersData = [
    {
      user_id: userId,
      reminder_text: 'Review Personal App features',
      scheduled_for: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      space_type: 'app'
    },
    {
      user_id: userId,
      reminder_text: 'Submit data safety questionnaire',
      scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      space_type: 'app'
    },
    {
      user_id: userId,
      reminder_text: 'Verify store screenshots on console',
      scheduled_for: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      space_type: 'app'
    },
    {
      user_id: userId,
      reminder_text: 'Test voice commands with Aaria',
      scheduled_for: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      space_type: 'app'
    },
    {
      user_id: userId,
      reminder_text: 'Approve release AABs',
      scheduled_for: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
      is_active: true,
      space_type: 'app'
    }
  ];

  const { error: remindersErr } = await supabase.from('reminders').insert(remindersData);
  if (remindersErr) {
    console.error('Failed to insert reminders:', remindersErr.message);
    process.exit(1);
  }

  // 6. Populate Keeps (4 items)
  console.log('Populating keeps...');
  const keepsData = [
    {
      user_id: userId,
      content: 'Play Console Release checklist: 1. keystore password verified, 2. icons set, 3. data safety correct.',
      status: 'open',
      intent_type: 'note',
      is_pinned: true,
      show_on_brief: true,
      confidence: 1.0,
      parsing_method: 'manual'
    },
    {
      user_id: userId,
      content: 'Remember to verify the GST place of supply split: CGST+SGST vs IGST.',
      status: 'open',
      intent_type: 'note',
      is_pinned: false,
      show_on_brief: true,
      confidence: 1.0,
      parsing_method: 'manual'
    },
    {
      user_id: userId,
      content: 'Aaria hotword engine should return false when wake word is detected natively to avoid background audio uploads.',
      status: 'open',
      intent_type: 'note',
      is_pinned: false,
      show_on_brief: true,
      confidence: 1.0,
      parsing_method: 'manual'
    },
    {
      user_id: userId,
      content: 'Google Sign-In natively is expected to fail on test builds due to missing Android OAuth client config.',
      status: 'open',
      intent_type: 'note',
      is_pinned: false,
      show_on_brief: true,
      confidence: 1.0,
      parsing_method: 'manual'
    }
  ];

  const { error: keepsErr } = await supabase.from('keeps').insert(keepsData);
  if (keepsErr) {
    console.error('Failed to insert keeps:', keepsErr.message);
    process.exit(1);
  }

  // 7. Populate Expenses (4 items)
  console.log('Populating expenses...');
  const expensesData = [
    {
      user_id: userId,
      amount: 1500,
      category: 'other',
      description: 'Vercel Hobby plan addon',
      expense_date: '2026-08-15',
      currency: 'INR',
      payment_method: 'upi'
    },
    {
      user_id: userId,
      amount: 800,
      category: 'other',
      description: 'Domain registration quietkeep.com',
      expense_date: '2026-08-16',
      currency: 'INR',
      payment_method: 'upi'
    },
    {
      user_id: userId,
      amount: 25000,
      category: 'other',
      description: 'Privacy policy drafting by counsel',
      expense_date: '2026-08-17',
      currency: 'INR',
      payment_method: 'upi'
    },
    {
      user_id: userId,
      amount: 12000,
      category: 'other',
      description: 'Testing device purchase',
      expense_date: '2026-08-18',
      currency: 'INR',
      payment_method: 'cash'
    }
  ];

  const { error: expensesErr } = await supabase.from('expenses').insert(expensesData);
  if (expensesErr) {
    console.error('Failed to insert expenses:', expensesErr.message);
    process.exit(1);
  }

  // 8. Populate Business Customers (4 items)
  console.log('Populating business customers...');
  const customersData = [
    {
      workspace_id: workspaceId,
      name: 'Acme Corp',
      phone: '9876543210',
      email: 'contact@acme.com',
      gstin: '36AAAAA0000A1Z1',
      outstanding_balance: 5000,
      total_business: 25000
    },
    {
      workspace_id: workspaceId,
      name: 'Kirana Stores kukatpally',
      phone: '8765432109',
      email: 'kirana@gmail.com',
      gstin: null,
      outstanding_balance: 1200,
      total_business: 8000
    },
    {
      workspace_id: workspaceId,
      name: 'Vikas Distributors',
      phone: '7654321098',
      email: 'vikas@vikas.com',
      gstin: '37BBBBB1111B2Z2',
      outstanding_balance: 0,
      total_business: 45000
    },
    {
      workspace_id: workspaceId,
      name: 'Individual Client',
      phone: '6543210987',
      email: null,
      gstin: null,
      outstanding_balance: 450,
      total_business: 1500
    }
  ];

  const { error: customersErr } = await supabase.from('business_customers').insert(customersData);
  if (customersErr) {
    console.error('Failed to insert business customers:', customersErr.message);
    process.exit(1);
  }

  // 9. Populate Business Invoices (3 items)
  console.log('Populating business invoices...');
  const invoicesData = [
    {
      workspace_id: workspaceId,
      invoice_number: 'INV-2026-001',
      customer_name: 'Acme Corp',
      customer_phone: '9876543210',
      customer_gstin: '36AAAAA0000A1Z1',
      invoice_date: '2026-08-10',
      due_date: '2026-08-25',
      subtotal: 10000,
      total_gst: 1800,
      cgst: 900,
      sgst: 900,
      igst: 0,
      total_amount: 11800,
      amount_paid: 11800,
      amount_due: 0,
      status: 'paid',
      line_items: [
        { name: 'Product A', qty: 2, rate: 5000, total: 10000, gstRate: 18, gst: 1800 }
      ]
    },
    {
      workspace_id: workspaceId,
      invoice_number: 'INV-2026-002',
      customer_name: 'Vikas Distributors',
      customer_phone: '7654321098',
      customer_gstin: '37BBBBB1111B2Z2',
      invoice_date: '2026-08-12',
      due_date: '2026-08-27',
      subtotal: 20000,
      total_gst: 3600,
      cgst: 0,
      sgst: 0,
      igst: 3600,
      total_amount: 23600,
      amount_paid: 20000,
      amount_due: 3600,
      status: 'unpaid',
      line_items: [
        { name: 'Product B', qty: 1, rate: 20000, total: 20000, gstRate: 18, gst: 3600 }
      ]
    },
    {
      workspace_id: workspaceId,
      invoice_number: 'INV-2026-003',
      customer_name: 'Kirana Stores kukatpally',
      customer_phone: '8765432109',
      customer_gstin: null,
      invoice_date: '2026-08-15',
      due_date: '2026-08-30',
      subtotal: 5000,
      total_gst: 900,
      cgst: 450,
      sgst: 450,
      igst: 0,
      total_amount: 5900,
      amount_paid: 0,
      amount_due: 5900,
      status: 'unpaid',
      line_items: [
        { name: 'Services C', qty: 5, rate: 1000, total: 5000, gstRate: 18, gst: 900 }
      ]
    }
  ];

  const { error: invoicesErr } = await supabase.from('business_invoices').insert(invoicesData);
  if (invoicesErr) {
    console.error('Failed to insert business invoices:', invoicesErr.message);
    process.exit(1);
  }

  // 10. Populate Business Ledger (3 items)
  console.log('Populating business ledger...');
  const ledgerData = [
    {
      workspace_id: workspaceId,
      entry_type: 'credit',
      category: 'sales',
      party_name: 'Acme Corp',
      party_phone: '9876543210',
      amount: 11800,
      description: 'Received full payment for INV-2026-001',
      payment_method: 'upi',
      payment_status: 'paid',
      source: 'manual',
      transaction_date: '2026-08-11',
      created_by: userId
    },
    {
      workspace_id: workspaceId,
      entry_type: 'debit',
      category: 'purchase',
      party_name: 'Standard Supplier',
      party_phone: null,
      amount: 8500,
      description: 'Office supplies bulk purchase',
      payment_method: 'cash',
      payment_status: 'paid',
      source: 'manual',
      transaction_date: '2026-08-14',
      created_by: userId
    },
    {
      workspace_id: workspaceId,
      entry_type: 'credit',
      category: 'sales',
      party_name: 'Kirana Stores kukatpally',
      party_phone: '8765432109',
      amount: 2000,
      description: 'Partial advance for orders',
      payment_method: 'cash',
      payment_status: 'paid',
      source: 'manual',
      transaction_date: '2026-08-16',
      created_by: userId
    }
  ];

  const { error: ledgerErr } = await supabase.from('business_ledger').insert(ledgerData);
  if (ledgerErr) {
    console.error('Failed to insert business ledger entries:', ledgerErr.message);
    process.exit(1);
  }

  // 11. Populate Business Members (2 staff members)
  console.log('Populating business members...');
  const membersData = [
    {
      workspace_id: workspaceId,
      name: 'Rohan Kumar',
      email: 'rohan@quietkeep.com',
      phone: '9123456780',
      role: 'staff',
      access_role: 'staff',
      status: 'active',
      date_of_joining: '2026-08-01'
    },
    {
      workspace_id: workspaceId,
      name: 'Priya Sharma',
      email: 'priya@quietkeep.com',
      phone: '9123456781',
      role: 'manager',
      access_role: 'manager',
      status: 'active',
      date_of_joining: '2026-08-05'
    }
  ];

  const { error: membersErr } = await supabase.from('business_members').insert(membersData);
  if (membersErr) {
    console.error('Failed to insert staff members:', membersErr.message);
    process.exit(1);
  }

  console.log('Reviewer account setup completed successfully!');
}

setup().catch(err => {
  console.error('Setup failed with unhandled error:', err);
  process.exit(1);
});
