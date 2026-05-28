'use client';
import { useAuth } from '@/lib/context/auth';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

// Guard: only create Supabase client if env vars are present
// Missing vars caused 'undefined' string in SSR HTML → smoke test failures
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey)
  ? createBrowserClient(supabaseUrl, supabaseKey)
  : null;
