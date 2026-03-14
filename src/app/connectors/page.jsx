'use client';
// NEW FILE: src/app/connectors/page.jsx
// Sprint 2B — App Connectors Registry
// Reads/writes user_connectors table (12 rows already live)
// Deep links: Google Maps, Spotify, WhatsApp, Zomato, Blinkit, YouTube Music, etc.

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const CONNECTORS = [
  {
    id: 'google_maps', name: 'Google Maps', icon: '🗺️', category: 'Navigation',
    desc: 'Opens navigation when you add a location keep',
    deep_link: 'https://maps.google.com',
    color: '#60a5fa',
  },
  {
    id: 'whatsapp', name: 'WhatsApp', icon: '💬', category: 'Communication',
    desc: 'Share keeps and briefs via WhatsApp',
    deep_link: 'https://wa.me/',
    color: '#4ade80',
  },
  {
    id: 'zomato', name: 'Zomato', icon: '🍕', category: 'Food',
    desc: 'Opens Zomato when you add a food/restaurant keep',
    deep_link: 'https://zomato.com',
    color: '#f87171',
  },
  {
    id: 'swiggy', name: 'Swiggy', icon: '🛵', category: 'Food',
    desc: 'Opens Swiggy for food delivery keeps',
    deep_link: 'https://swiggy.com',
    color: '#fb923c',
  },
  {
    id: 'blinkit', name: 'Blinkit', icon: '⚡', category: 'Grocery',
    desc: 'Opens Blinkit for grocery/quick commerce keeps',
    deep_link: 'https://blinkit.com',
    color: '#facc15',
  },
  {
    id: 'spotify', name: 'Spotify', icon: '🎵', category: 'Music',
    desc: 'Opens Spotify in Drive Mode',
    deep_link: 'spotify://',
    color: '#4ade80',
  },
  {
    id: 'youtube_music', name: 'YouTube Music', icon: '🎶', category: 'Music',
    desc: 'Opens YouTube Music in Drive Mode',
    deep_link: 'https://music.youtube.com',
    color: '#f87171',
  },
  {
    id: 'cart2save', name: 'Cart2Save', icon: '🛒', category: 'Shopping',
    desc: 'Opens Cart2Save for shopping keeps — neutral ONDC discovery',
    deep_link: 'https://cart2save.com',
    color: '#a78bfa',
  },
  {
    id: 'amazon', name: 'Amazon India', icon: '📦', category: 'Shopping',
    desc: 'Opens Amazon for purchase keeps',
    deep_link: 'https://amazon.in',
    color: '#fbbf24',
  },
  {
    id: 'google_calendar', name: 'Google Calendar', icon: '📅', category: 'Productivity',
    desc: 'Deep link to Google Calendar for scheduling keeps',
    deep_link: 'https://calendar.google.com',
    color: '#60a5fa',
  },
  {
    id: 'gpay', name: 'Google Pay', icon: '💳', category: 'Finance',
    desc: 'Opens GPay for payment and expense keeps',
    deep_link: 'tez://upi/',
    color: '#4ade80',
  },
  {
    id: 'paytm', name: 'Paytm', icon: '💰', category: 'Finance',
    desc: 'Opens Paytm for bill payment keeps',
    deep_link: 'paytmmp://',
    color: '#38bdf8',
  },
];

const CATEGORIES = [...new Set(CONNECTORS.map(c => c.category))];

export default function ConnectorsPage() {
  const [enabled, setEnabled] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [user, setUser] = useState(null);
  const [catFilter, setCatFilter] = useState('All');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      setUser(user);
      loadConnectors(user.id);
    });
  }, []);

  async function loadConnectors(uid) {
    const { data } = await supabase
      .from('user_connectors')
      .select('connector_name, is_enabled')
      .eq('user_id', uid);
