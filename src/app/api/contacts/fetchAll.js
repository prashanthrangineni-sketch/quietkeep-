// src/app/api/contacts/fetchAll.js
// Card C1: Fetch all contacts for a user across Supabase 1,000-row default limit.

export const CONTACTS_PAGE_SIZE = 1000;

/**
 * Fetches all contacts for a user by paging in chunks (default 1,000)
 * until fewer than the chunk size are returned.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId - User ID
 * @param {object} [options]
 * @param {number} [options.pageSize=1000] - Chunk size
 * @param {string} [options.select] - Columns to select
 * @returns {Promise<Array>} Array of contact objects
 */
export async function fetchAllContacts(supabase, userId, options = {}) {
  if (!supabase || !userId) return [];
  const pageSize = options.pageSize || CONTACTS_PAGE_SIZE;
  const selectCols = options.select || 'id,name,phone,email,relation,avatar_emoji,is_favorite,source';

  const all = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('contacts')
      .select(selectCols)
      .eq('user_id', userId)
      .order('is_favorite', { ascending: false })
      .order('name')
      .range(from, to);

    if (error) {
      console.error('Error fetching contacts chunk:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    all.push(...data);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return all;
}
