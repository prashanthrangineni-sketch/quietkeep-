'use client';
// src/app/business/page.jsx
// FIX: This page previously showed "Coming Soon" which contradicted the live product.
// Now redirects to /biz-login so any user who lands here via SEO or old links
// is taken directly to the business login flow.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BusinessPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/biz-login');
  }, [router]);
  // Render nothing — redirect fires immediately
  return null;
}
