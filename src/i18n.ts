import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

const SUPPORTED_LOCALES = ['en', 'hi', 'te'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

function isValidLocale(l: string): l is Locale {
  return SUPPORTED_LOCALES.includes(l as Locale);
}

export default getRequestConfig(async () => {
  // Priority: 1. Cookie set by Settings page, 2. Default to 'en'
  let locale: Locale = 'en';
  try {
    const cookieStore = await cookies();
    const lang = cookieStore.get('qk_display_lang')?.value;
    if (lang && isValidLocale(lang)) {
      locale = lang;
    }
  } catch {
    // cookies() not available in edge context — fall back to 'en'
    locale = 'en';
  }

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default
  };
});
